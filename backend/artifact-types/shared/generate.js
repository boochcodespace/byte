// artifact-types/shared/generate.js
//
// The one shared function every artifact type's generate() delegates
// to. Keeps Claude-call orchestration, JSON parsing, schema validation,
// and artifact persistence in a single place so each type module only
// has to own its prompt template, schema, and output shape.
//
// Why per-type generate() wrappers exist at all, if every one is a
// passthrough today: future types may want different models or token
// budgets. Keeping the entry point per-type means those overrides
// land as a single-line change inside the type module instead of a
// special case inside this shared helper. See flip-card-deck/index.js
// for the canonical passthrough shape.

const fs = require('fs')
const path = require('path')
const Anthropic = require('@anthropic-ai/sdk')
const Ajv = require('ajv')
const { SYSTEM_PROMPT } = require('./system-prompt')

const DEFAULT_MODEL = 'claude-sonnet-4-6'
const DEFAULT_MAX_TOKENS = 4096

// Compile schemas once per process. Keyed by type so a shared validator
// instance services every type without recompiling on each call.
const ajv = new Ajv({ allErrors: true, strict: false })
const validatorsByType = new Map()

function getValidator(typeModule) {
  let v = validatorsByType.get(typeModule.type)
  if (!v) {
    v = ajv.compile(typeModule.schema)
    validatorsByType.set(typeModule.type, v)
  }
  return v
}

// Strip common wrappers Claude sometimes adds despite our "no fences"
// instruction in the system prompt. Kept forgiving because the JSON
// itself is what we need to preserve; fences around it are noise.
function stripFences(text) {
  return text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

// Thrown when Claude returns a shape that doesn't match the type's
// schema. Carries enough detail for the route handler to surface an
// actionable error (and for Phase 2B-2 refinement to inspect).
class SchemaValidationError extends Error {
  constructor(type, errors) {
    super(`Response failed ${type} schema validation`)
    this.name = 'SchemaValidationError'
    this.type = type
    this.errors = errors
  }
}

// Thrown when Claude's response can't be JSON.parsed. Distinct from
// schema-validation failures so the HTTP layer can log / retry
// differently.
class ClaudeJsonParseError extends Error {
  constructor(raw) {
    super('Claude response was not valid JSON')
    this.name = 'ClaudeJsonParseError'
    this.raw = raw
  }
}

// Main entry point used by every artifact-type module's generate().
//
//   typeModule      — the module exporting { type, promptTemplate, schema, ... }
//   promptContext   — struct built by buildPromptContext()
//   extras          — type-specific prompt inputs (e.g. knowledge-check format)
//   sourceDir       — absolute path to the source on disk (for saving)
//   apiKey          — Anthropic API key
//   modelOverrides  — { model?, maxTokens? } to override per-call
async function runGeneration({
  typeModule,
  promptContext,
  extras = {},
  sourceDir,
  apiKey,
  modelOverrides = {},
}) {
  const userPrompt = typeModule.promptTemplate(promptContext, extras)

  const anthropic = new Anthropic({ apiKey })
  const response = await anthropic.messages.create({
    model: modelOverrides.model || DEFAULT_MODEL,
    max_tokens: modelOverrides.maxTokens || DEFAULT_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const rawText = stripFences(response.content[0].text)

  let parsed
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new ClaudeJsonParseError(rawText)
  }

  const validate = getValidator(typeModule)
  if (!validate(parsed)) {
    throw new SchemaValidationError(typeModule.type, validate.errors)
  }

  // Stamp the type field so the renderer registry can pick the right
  // component for this artifact (backwards compat: old artifacts lack
  // this field and the registry defaults to 'flip-card-deck').
  const artifact = { type: typeModule.type, ...parsed }

  const timestamp = Date.now()
  const folderName = `${typeModule.type}-${timestamp}`
  const artifactDir = path.join(sourceDir, 'artifacts', folderName)
  fs.mkdirSync(artifactDir, { recursive: true })
  fs.writeFileSync(
    path.join(artifactDir, 'artifact.json'),
    JSON.stringify(artifact, null, 2)
  )

  return { folder: folderName, ...artifact }
}

module.exports = {
  runGeneration,
  SchemaValidationError,
  ClaudeJsonParseError,
}
