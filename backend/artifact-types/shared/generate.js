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
const Ajv = require('ajv')
const { SYSTEM_PROMPT } = require('./system-prompt')
const { ERROR_TYPES } = require('../../lib/error-types')
const llm = require('../../lib/llm')

const DEFAULT_MAX_TOKENS = 4096

// Compile schemas once per process. Keyed by a caller-supplied name (an
// artifact type, or a lesson step such as "lesson-blueprint") so a shared
// validator instance services every caller without recompiling.
const ajv = new Ajv({ allErrors: true, strict: false })
const validatorsByKey = new Map()

function getValidator(key, schema) {
  let v = validatorsByKey.get(key)
  if (!v) {
    v = ajv.compile(schema)
    validatorsByKey.set(key, v)
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
// `.errorType` tags it so the route layer can funnel it through the
// same error-classification path as SDK-level failures.
class SchemaValidationError extends Error {
  constructor(type, errors) {
    super(`Response failed ${type} schema validation`)
    this.name = 'SchemaValidationError'
    this.errorType = ERROR_TYPES.SCHEMA_VALIDATION
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
    this.errorType = ERROR_TYPES.MALFORMED_JSON
    this.raw = raw
  }
}

// Call the model, parse its JSON, and validate it against a schema.
// Saves nothing. This is the shared core: artifact generation wraps it
// (runGeneration below) and so does the lesson generator, which needs
// structured output but not a saved artifact folder.
//
//   key         — name used to cache the compiled schema, and reported in
//                 SchemaValidationError (an artifact type or lesson step)
//   schema      — JSON Schema the response must satisfy
//   userPrompt  — the full user message
//   llmConfig   — resolved provider config (see lib/llm/config.js)
//   maxTokens   — optional output budget (default 4096)
//
// Throws ClaudeJsonParseError or SchemaValidationError, both tagged with
// .errorType so the route layer can answer with the standard envelope.
async function generateValidated({ key, schema, userPrompt, llmConfig, maxTokens }) {
  const text = await llm.complete(llmConfig, {
    system: SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: maxTokens || DEFAULT_MAX_TOKENS,
  })

  const rawText = stripFences(text)

  let parsed
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new ClaudeJsonParseError(rawText)
  }

  const validate = getValidator(key, schema)
  if (!validate(parsed)) {
    throw new SchemaValidationError(key, validate.errors)
  }
  return parsed
}

// Main entry point used by every artifact-type module's generate().
//
//   typeModule      — the module exporting { type, promptTemplate, schema, ... }
//   promptContext   — struct built by buildPromptContext()
//   extras          — type-specific prompt inputs (e.g. knowledge-check format)
//   sourceDir       — absolute path to the source on disk (for saving)
//   llmConfig       — resolved provider config (see lib/llm/config.js):
//                     which adapter, key, model, and base URL to use
//   modelOverrides  — { maxTokens? } to override per-call. Model choice
//                     is the user's (Settings), not the artifact type's,
//                     because model names differ between providers.
async function runGeneration({
  typeModule,
  promptContext,
  extras = {},
  sourceDir,
  llmConfig,
  modelOverrides = {},
}) {
  const userPrompt = typeModule.promptTemplate(promptContext, extras)

  const parsed = await generateValidated({
    key: typeModule.type,
    schema: typeModule.schema,
    userPrompt,
    llmConfig,
    maxTokens: modelOverrides.maxTokens,
  })

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
  generateValidated,
  SchemaValidationError,
  ClaudeJsonParseError,
}
