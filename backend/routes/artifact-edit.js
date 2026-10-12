// routes/artifact-edit.js: edit a saved artifact's text, in place (D2).
//
// Mounted under projects:  /api/projects/:projectSlug/artifacts
//
//   GET  /:source/:folder        the artifact, what needs fixing, and the lessons that use it
//   PUT  /:source/:folder        save edited text (validated against the type's schema)
//   POST /:source/:folder/copy   a copy in the same source folder
//   POST /:source/:folder/alt-text/draft   draft alt text from a visual brief (saves nothing)
//
// An artifact is shared by every lesson that points at it. The GET lists those
// lessons so the page can warn before an edit that changes them all.

const express = require('express')
const router = express.Router({ mergeParams: true })
const { sendOk, sendError, mapSdkError } = require('../lib/error-types')
const { LessonError } = require('../lessons/errors')
const edit = require('../lib/artifact-edit')
const { resolveLlmConfig } = require('../lib/llm/config')
const { ERROR_TYPES } = require('../lib/error-types')
const service = require('../lessons/service')

function fail(res, tag, err) {
  if (err instanceof LessonError) return sendError(res, err.errorType, { userMessage: err.userMessage })
  // typed generation errors (malformed JSON, schema) carry their own errorType
  const classified = err.errorType
    ? { errorType: err.errorType, debug: { message: err.message, raw: err.raw?.slice(0, 500), errors: err.errors } }
    : mapSdkError(err)
  console.error(`[${tag}]`, classified.errorType, classified.debug || err)
  return sendError(res, classified.errorType, { debug: classified.debug })
}

router.get('/:source/:folder', (req, res) => {
  try {
    const { projectSlug, source, folder } = req.params
    return sendOk(res, edit.readEditable(projectSlug, source, folder))
  } catch (err) {
    return fail(res, 'artifact-edit:get', err)
  }
})

router.put('/:source/:folder', (req, res) => {
  try {
    const { projectSlug, source, folder } = req.params
    const saved = edit.saveEdits(projectSlug, source, folder, req.body || {})
    return sendOk(res, { ...saved, usage: edit.usageOf(projectSlug, source, folder) })
  } catch (err) {
    return fail(res, 'artifact-edit:put', err)
  }
})

// Draft alt text from a visual brief for a saved artifact. Saves nothing.
router.post('/:source/:folder/alt-text/draft', async (req, res) => {
  try {
    const { projectSlug, source, folder } = req.params
    const { artifact } = edit.readEditable(projectSlug, source, folder)
    const { config, problem } = resolveLlmConfig()
    if (problem === 'api_key') return sendError(res, ERROR_TYPES.MISSING_API_KEY)
    if (problem === 'model') return sendError(res, ERROR_TYPES.INVALID_MODEL)
    const objective = artifact.learning_objective || 'this artifact'
    return sendOk(res, await service.draftAltTextFor({ topic: objective, objective, visual: (req.body || {}).visual }, config))
  } catch (err) {
    return fail(res, 'artifact-edit:alt-text', err)
  }
})

router.post('/:source/:folder/copy', (req, res) => {
  try {
    const { projectSlug, source, folder } = req.params
    return sendOk(res, edit.copyArtifact(projectSlug, source, folder))
  } catch (err) {
    return fail(res, 'artifact-edit:copy', err)
  }
})

module.exports = router
