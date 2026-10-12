// routes/artifacts.js — HTTP dispatch for artifact generation.
//
// Mounted as a nested router under sources:
//   POST /api/projects/:projectSlug/sources/:sourceSlug/artifacts/generate
//
// mergeParams: true lets req.params carry both :projectSlug and
// :sourceSlug from the parent routers into this handler.
//
// All type-specific logic (prompt building, schema validation,
// output shape, saving) lives in backend/artifact-types/<type>/.
// This file is intentionally thin: parse the body, look up the type
// module, delegate, translate errors to the envelope response.

const express = require('express')
const router = express.Router({ mergeParams: true })
const fs = require('fs')
const path = require('path')
const os = require('os')
const { getTypeModule, listSupportedTypes } = require('../artifact-types/registry')
const { buildPromptContext } = require('../artifact-types/shared/build-prompt-context')
const {
  ERROR_TYPES,
  sendOk,
  sendError,
  mapSdkError,
} = require('../lib/error-types')
const { resolveLlmConfig } = require('../lib/llm/config')

const PROJECTS_DIR = path.join(os.homedir(), 'Byte', 'projects')

// POST .../artifacts/generate
router.post('/generate', async (req, res) => {
  const { projectSlug, sourceSlug } = req.params
  const {
    artifactType,
    perGenerationPrompt,
    perGenerationObjective,
    ...extras // type-specific extras passed through (e.g. format for
              // knowledge-check in a future step)
  } = req.body

  if (!artifactType) {
    return sendError(res, ERROR_TYPES.VALIDATION, { userMessage: 'artifactType is required' })
  }
  const typeModule = getTypeModule(artifactType)
  if (!typeModule) {
    return sendError(res, ERROR_TYPES.VALIDATION, {
      userMessage: `Artifact type "${artifactType}" is not supported. Supported: ${listSupportedTypes().join(', ')}`,
    })
  }

  // Which provider/model/key to use comes from Settings. A missing key
  // or model is a recoverable setup problem, not a server fault.
  const { config: llmConfig, problem } = resolveLlmConfig()
  if (problem === 'api_key') return sendError(res, ERROR_TYPES.MISSING_API_KEY)
  if (problem === 'model') return sendError(res, ERROR_TYPES.INVALID_MODEL)

  const sourceDir = path.join(PROJECTS_DIR, projectSlug, 'sources', sourceSlug)
  if (!fs.existsSync(sourceDir)) {
    return sendError(res, ERROR_TYPES.NOT_FOUND, { userMessage: 'Source not found.' })
  }

  const mdPath = path.join(sourceDir, 'source.md')
  const sourceContent = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf-8') : ''

  // Older sources/projects may lack the newer fields; read-or-empty
  // keeps the prompt context assembler on the happy path.
  const ctxPath = path.join(sourceDir, 'context.json')
  const context = fs.existsSync(ctxPath)
    ? JSON.parse(fs.readFileSync(ctxPath, 'utf-8'))
    : {}

  const projectPath = path.join(PROJECTS_DIR, projectSlug, 'project.json')
  const project = fs.existsSync(projectPath)
    ? JSON.parse(fs.readFileSync(projectPath, 'utf-8'))
    : {}

  const promptContext = buildPromptContext({
    sourceContent,
    context,
    project,
    perGenerationPrompt,
    perGenerationObjective,
  })

  try {
    const result = await typeModule.generate({
      promptContext,
      extras,
      sourceDir,
      llmConfig,
    })
    return sendOk(res, result)
  } catch (err) {
    // Our typed errors (SchemaValidationError, ClaudeJsonParseError)
    // carry .errorType. SDK / network / fs errors are classified via
    // mapSdkError. Unknown errors fall through to UNKNOWN.
    const classified = err.errorType
      ? { errorType: err.errorType, debug: { message: err.message, raw: err.raw?.slice(0, 500), errors: err.errors } }
      : mapSdkError(err)

    console.error(`[generate] ${classified.errorType}:`, classified.debug || err)
    return sendError(res, classified.errorType, { debug: classified.debug })
  }
})

module.exports = router
