// parsers/errors.js — typed errors that cross the parser → route boundary.
//
// UserFacingError signals "reject the upload cleanly with this exact message,
// don't write anything to disk". Thrown from preflight checks. The route
// handler detects it by instanceof and responds 400.
//
// Any other error thrown by a parser is considered an unexpected failure and
// falls through to the route's existing fallback (writes a "could not parse"
// marker into source.md, preserves the original).

class UserFacingError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UserFacingError'
  }
}

module.exports = { UserFacingError }
