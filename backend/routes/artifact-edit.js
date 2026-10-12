// routes/artifact-edit.js: edit a saved artifact's text, in place (D2).
//
// Mounted under projects:  /api/projects/:projectSlug/artifacts
//
//   GET  /:source/:folder        the artifact, what needs fixing, and the lessons that use it
//   PUT  /:source/:folder        save edited text (validated against the type's schema)
//   POST /:source/:folder/copy   a copy in the same source folder
//
// An artifact is shared by every lesson that points at it. The GET lists those
// lessons so the page can warn before an edit that changes them all.

const express = require('express')
const router = express.Router({ mergeParams: true })
const { sendOk, sendError, mapSdkError } = require('../lib/error-types')
const { LessonError } = require('../lessons/errors')
const edit = require('../lib/artifact-edit')

function fail(res, tag, err) {
  if (err instanceof LessonError) return sendError(res, err.errorType, { userMessage: err.userMessage })
  const { errorType, debug } = mapSdkError(err)
  console.error(`[${tag}]`, errorType, debug || err)
  return sendError(res, errorType, { debug })
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

router.post('/:source/:folder/copy', (req, res) => {
  try {
    const { projectSlug, source, folder } = req.params
    return sendOk(res, edit.copyArtifact(projectSlug, source, folder))
  } catch (err) {
    return fail(res, 'artifact-edit:copy', err)
  }
})

module.exports = router
