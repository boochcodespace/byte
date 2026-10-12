// routes/lessons.js — HTTP layer for lessons.
//
// Mounted under projects:  /api/projects/:projectSlug/lessons
//
//   GET    /                                   list lessons
//   POST   /                                   create (no model call)
//   GET    /:lessonId                          lesson + resolved artifacts
//   POST   /:lessonId/blueprint/generate       model call
//   PUT    /:lessonId/blueprint                edit and/or approve
//   POST   /:lessonId/text/generate            model call
//   POST   /:lessonId/blocks                   insert a tabs block or an artifact
//   POST   /:lessonId/blocks/:blockId/tabs/generate  write (or rewrite) tabs
//   PUT    /:lessonId/blocks/:blockId/tabs     edit tabs inline
//   POST   /:lessonId/blocks/:blockId/artifact accept a placement, or replace
//   PUT    /:lessonId/blocks/:blockId/text     edit a text block inline
//   DELETE /:lessonId/blocks/:blockId          remove a block (an artifact
//                                              itself stays; not the last hook)
//
// All logic lives in lessons/service.js. This file only parses the
// request, checks ids, resolves the AI provider, and turns errors into
// the standard envelope.

const express = require('express')
const router = express.Router({ mergeParams: true })
const {
  ERROR_TYPES,
  sendOk,
  sendError,
  mapSdkError,
} = require('../lib/error-types')
const { resolveLlmConfig } = require('../lib/llm/config')
const { LessonError, notFound } = require('../lessons/errors')
const { isSafeSegment } = require('../lessons/store')
const service = require('../lessons/service')

// Turn any thrown error into the envelope. LessonError carries its own
// type and message; typed generation errors carry .errorType; everything
// else is classified like a provider or disk failure.
function fail(res, tag, err) {
  if (err instanceof LessonError) {
    return sendError(res, err.errorType, { userMessage: err.userMessage })
  }
  const classified = err.errorType
    ? { errorType: err.errorType, debug: { message: err.message, raw: err.raw?.slice(0, 500), errors: err.errors } }
    : mapSdkError(err)
  console.error(`[${tag}] ${classified.errorType}:`, classified.debug || err)
  return sendError(res, classified.errorType, { debug: classified.debug })
}

// Provider settings for routes that call the model. Sends the error and
// returns null when something is missing.
function requireLlm(res) {
  const { config, problem } = resolveLlmConfig()
  if (problem === 'api_key') { sendError(res, ERROR_TYPES.MISSING_API_KEY); return null }
  if (problem === 'model') { sendError(res, ERROR_TYPES.INVALID_MODEL); return null }
  return config
}

function checkIds(req) {
  const { projectSlug, lessonId, blockId } = req.params
  if (!isSafeSegment(projectSlug)) throw notFound('Project not found.')
  if (lessonId !== undefined && !isSafeSegment(lessonId)) throw notFound('Lesson not found.')
  if (blockId !== undefined && !isSafeSegment(blockId)) throw notFound('That block was not found.')
}

router.get('/', (req, res) => {
  try {
    checkIds(req)
    return sendOk(res, service.listLessons(req.params.projectSlug))
  } catch (err) {
    return fail(res, 'lessons:list', err)
  }
})

router.post('/', (req, res) => {
  try {
    checkIds(req)
    return sendOk(res, service.createLesson(req.params.projectSlug, req.body || {}))
  } catch (err) {
    return fail(res, 'lessons:create', err)
  }
})

router.get('/:lessonId', (req, res) => {
  try {
    checkIds(req)
    return sendOk(res, service.getLesson(req.params.projectSlug, req.params.lessonId))
  } catch (err) {
    return fail(res, 'lessons:get', err)
  }
})

router.post('/:lessonId/blueprint/generate', async (req, res) => {
  try {
    checkIds(req)
    const llmConfig = requireLlm(res)
    if (!llmConfig) return
    const { projectSlug, lessonId } = req.params
    return sendOk(res, await service.generateBlueprint(projectSlug, lessonId, llmConfig))
  } catch (err) {
    return fail(res, 'lessons:blueprint', err)
  }
})

router.put('/:lessonId/blueprint', (req, res) => {
  try {
    checkIds(req)
    const { projectSlug, lessonId } = req.params
    return sendOk(res, service.editBlueprint(projectSlug, lessonId, req.body || {}))
  } catch (err) {
    return fail(res, 'lessons:blueprint-edit', err)
  }
})

router.post('/:lessonId/text/generate', async (req, res) => {
  try {
    checkIds(req)
    const llmConfig = requireLlm(res)
    if (!llmConfig) return
    const { projectSlug, lessonId } = req.params
    return sendOk(res, await service.generateText(projectSlug, lessonId, llmConfig))
  } catch (err) {
    return fail(res, 'lessons:text', err)
  }
})

router.post('/:lessonId/blocks/:blockId/artifact', async (req, res) => {
  try {
    checkIds(req)
    const { projectSlug, lessonId, blockId } = req.params
    const body = req.body || {}
    // Only the "new" mode calls the model; "existing" needs no provider.
    let llmConfig = null
    if (body.mode === 'new') {
      llmConfig = requireLlm(res)
      if (!llmConfig) return
    }
    return sendOk(res, await service.acceptPlacement(projectSlug, lessonId, blockId, body, llmConfig))
  } catch (err) {
    return fail(res, 'lessons:artifact', err)
  }
})

// Insert a new block after an existing one. Only the model-backed modes
// need an AI provider; writing tabs by hand or picking an existing
// artifact does not.
router.post('/:lessonId/blocks', async (req, res) => {
  try {
    checkIds(req)
    const { projectSlug, lessonId } = req.params
    const body = req.body || {}
    const usesModel =
      (body.kind === 'tabs' && body.mode === 'generate') ||
      (body.kind === 'artifact' && body.mode === 'new')
    let llmConfig = null
    if (usesModel) {
      llmConfig = requireLlm(res)
      if (!llmConfig) return
    }
    return sendOk(res, await service.insertBlock(projectSlug, lessonId, body, llmConfig))
  } catch (err) {
    return fail(res, 'lessons:insert', err)
  }
})

router.post('/:lessonId/blocks/:blockId/tabs/generate', async (req, res) => {
  try {
    checkIds(req)
    const llmConfig = requireLlm(res)
    if (!llmConfig) return
    const { projectSlug, lessonId, blockId } = req.params
    return sendOk(res, await service.generateTabs(projectSlug, lessonId, blockId, req.body || {}, llmConfig))
  } catch (err) {
    return fail(res, 'lessons:tabs-generate', err)
  }
})

router.put('/:lessonId/blocks/:blockId/tabs', (req, res) => {
  try {
    checkIds(req)
    const { projectSlug, lessonId, blockId } = req.params
    return sendOk(res, service.editTabs(projectSlug, lessonId, blockId, req.body || {}))
  } catch (err) {
    return fail(res, 'lessons:tabs-edit', err)
  }
})

router.put('/:lessonId/blocks/:blockId/text', (req, res) => {
  try {
    checkIds(req)
    const { projectSlug, lessonId, blockId } = req.params
    return sendOk(res, service.editTextBlock(projectSlug, lessonId, blockId, req.body || {}))
  } catch (err) {
    return fail(res, 'lessons:text-edit', err)
  }
})

router.delete('/:lessonId/blocks/:blockId', (req, res) => {
  try {
    checkIds(req)
    const { projectSlug, lessonId, blockId } = req.params
    return sendOk(res, service.removeBlock(projectSlug, lessonId, blockId))
  } catch (err) {
    return fail(res, 'lessons:remove', err)
  }
})

module.exports = router
