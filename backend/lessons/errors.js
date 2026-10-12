// backend/lessons/errors.js
//
// An error the lesson code raises on purpose, carrying the errorType and
// the plain-language message the user should see. Routes turn it into the
// standard error envelope. Anything that is NOT a LessonError (a model
// failure, a disk fault) goes through the shared classifier instead.

const { ERROR_TYPES } = require('../lib/error-types')

class LessonError extends Error {
  constructor(errorType, userMessage) {
    super(userMessage)
    this.name = 'LessonError'
    this.errorType = errorType
    this.userMessage = userMessage
  }
}

const validation = message => new LessonError(ERROR_TYPES.VALIDATION, message)
const notFound = message => new LessonError(ERROR_TYPES.NOT_FOUND, message)

module.exports = { LessonError, validation, notFound }
