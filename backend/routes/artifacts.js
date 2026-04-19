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
// module, delegate, translate errors to HTTP responses.

const express = require('express')
const router = express.Router({ mergeParams: true })
const fs = require('fs')
const path = require('path')
const os = require('os')
const { getTypeModule, listSupportedTypes } = require('../artifact-types/registry')
const { buildPromptContext } = require('../artifact-types/shared/build-prompt-context')
const {
  SchemaValidationError,
  ClaudeJsonParseError,
} = require('../artifact-types/shared/generate')

const PROJECTS_DIR = path.join(os.homedir(), 'Byte', 'projects')
const SETTINGS_FILE = path.join(os.homedir(), 'Byte', 'settings.json')

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
    return res.status(400).json({ error: 'artifactType is required' })
  }
  const typeModule = getTypeModule(artifactType)
  if (!typeModule) {
    return res.status(400).json({
      error: `Artifact type "${artifactType}" is not supported. Supported: ${listSupportedTypes().join(', ')}`,
    })
  }

  if (!fs.existsSync(SETTINGS_FILE)) {
    return res.status(400).json({
      error: 'No API key found. Go to Settings and paste your Anthropic API key.',
    })
  }
  const { apiKey } = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
  if (!apiKey) {
    return res.status(400).json({
      error: 'API key is empty. Go to Settings and paste your Anthropic API key.',
    })
  }

  const sourceDir = path.join(PROJECTS_DIR, projectSlug, 'sources', sourceSlug)
  if (!fs.existsSync(sourceDir)) {
    return res.status(404).json({ error: 'Source not found' })
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
      apiKey,
    })
    res.json(result)
  } catch (err) {
    // Translate known error types to friendly responses. Step 2 of
    // Phase 2B-1 adds client-side recoverable UX for these; the
    // backend error shape stays stable so Step 2 is a frontend-only
    // change on top of this contract.
    if (err instanceof ClaudeJsonParseError) {
      console.error('[generate] Claude returned non-JSON:', err.raw?.slice(0, 500))
      return res.status(500).json({
        error: 'Generation failed to produce valid output. Please try again.',
        raw: err.raw?.slice(0, 500),
      })
    }
    if (err instanceof SchemaValidationError) {
      console.error(`[generate] schema validation failed for ${err.type}:`, err.errors)
      return res.status(500).json({
        error: 'Generation produced output that failed schema validation. Please try again.',
        validationErrors: err.errors,
      })
    }
    console.error('[generate] unexpected error:', err)
    return res.status(500).json({
      error: err?.message
        ? `Claude API error: ${err.message}`
        : 'Unexpected error during generation. Check your API key and try again.',
    })
  }
})

module.exports = router
