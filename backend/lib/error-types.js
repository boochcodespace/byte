// backend/lib/error-types.js
//
// Canonical error-type vocabulary for the whole API. Every route uses
// these helpers so the frontend gets a single, stable shape to branch on.
//
// Envelope contract:
//   success  →  { ok: true, data: <payload> }
//   failure  →  { ok: false, errorType, userMessage, debug? }
//
// Why an enum instead of raw error strings: the UI needs to *decide*
// what to show (retry button vs link to Settings vs inline validation)
// based on the error. If that decision depends on regex-matching a
// human-readable string, a backend copy tweak silently breaks the
// frontend. Keying the decision on a fixed enum moves the contract
// away from the wording and into the code.
//
// `debug` is for the backend log only. Routes should still
// console.error enough detail to diagnose; we include debug in the
// response body so future diagnostics (e.g. a dev-mode panel) can
// pick it up, but the user-visible message is always userMessage.

const ERROR_TYPES = Object.freeze({
  MISSING_API_KEY:    'missing_api_key',
  INVALID_API_KEY:    'invalid_api_key',
  INVALID_MODEL:      'invalid_model',
  NETWORK:            'network',
  RATE_LIMIT:         'rate_limit',
  SERVER_ERROR:       'server_error',
  MALFORMED_JSON:     'malformed_json',
  SCHEMA_VALIDATION:  'schema_validation',
  FILESYSTEM:         'filesystem',
  NOT_FOUND:          'not_found',
  VALIDATION:         'validation',
  UNKNOWN:            'unknown',
})

// Default user-facing copy per errorType. Routes may override with a
// more specific message (e.g. a validation error naming the bad field).
const DEFAULT_USER_MESSAGES = {
  [ERROR_TYPES.MISSING_API_KEY]:   'Your AI provider API key is missing. Please check your settings.',
  [ERROR_TYPES.INVALID_API_KEY]:   'Your AI provider API key is invalid. Please check your settings.',
  [ERROR_TYPES.INVALID_MODEL]:     'Your AI provider did not recognize the selected model, or no model is chosen. Please check your settings.',
  [ERROR_TYPES.NETWORK]:           'Could not reach your AI provider. Check your internet connection (or that your local model server is running) and try again.',
  [ERROR_TYPES.RATE_LIMIT]:        'Rate limit reached. Please wait a moment and try again.',
  [ERROR_TYPES.SERVER_ERROR]:      "Your AI provider's service hit an error. This is usually temporary. Please try again.",
  [ERROR_TYPES.MALFORMED_JSON]:    'Generation failed to produce valid output. Please try again.',
  [ERROR_TYPES.SCHEMA_VALIDATION]: 'Generation failed to produce valid output. Please try again.',
  [ERROR_TYPES.FILESYSTEM]:        'Could not save your work. Please check your Byte data folder permissions.',
  [ERROR_TYPES.NOT_FOUND]:         'That item could not be found. It may have been deleted.',
  [ERROR_TYPES.VALIDATION]:        'Some fields are missing or invalid.',
  [ERROR_TYPES.UNKNOWN]:           'Something went wrong. Please try again.',
}

// Sensible HTTP statuses per errorType. Routes may override.
const DEFAULT_STATUS = {
  [ERROR_TYPES.MISSING_API_KEY]:   400,
  [ERROR_TYPES.INVALID_API_KEY]:   401,
  [ERROR_TYPES.INVALID_MODEL]:     400,
  [ERROR_TYPES.NETWORK]:           502,
  [ERROR_TYPES.RATE_LIMIT]:        429,
  [ERROR_TYPES.SERVER_ERROR]:      502,
  [ERROR_TYPES.MALFORMED_JSON]:    502,
  [ERROR_TYPES.SCHEMA_VALIDATION]: 502,
  [ERROR_TYPES.FILESYSTEM]:        500,
  [ERROR_TYPES.NOT_FOUND]:         404,
  [ERROR_TYPES.VALIDATION]:        400,
  [ERROR_TYPES.UNKNOWN]:           500,
}

// ── Response helpers ─────────────────────────────────────────────────
//
// sendOk and sendError are the only two ways routes should write a
// response body. Keeps the envelope shape consistent across the API.

function sendOk(res, data) {
  return res.json({ ok: true, data })
}

function sendError(res, errorType, {
  userMessage,
  debug,
  status,
} = {}) {
  const body = {
    ok: false,
    errorType,
    userMessage: userMessage || DEFAULT_USER_MESSAGES[errorType] || DEFAULT_USER_MESSAGES[ERROR_TYPES.UNKNOWN],
  }
  if (debug !== undefined) body.debug = debug
  return res.status(status || DEFAULT_STATUS[errorType] || 500).json(body)
}

// ── SDK error classification ─────────────────────────────────────────
//
// Translate a provider or Node error into our vocabulary. This is the
// one place where provider-specific knowledge lives; the rest of the
// backend only sees errorType + userMessage.
//
// Classification keys off the HTTP status every provider shares, so it
// covers the Anthropic SDK (typed errors with .status), the
// OpenAI-compatible adapter (ProviderHttpError with .status), and raw
// Node transport errors (ENOTFOUND, ECONNREFUSED, request timeout).

function mapSdkError(err) {
  if (!err) {
    return { errorType: ERROR_TYPES.UNKNOWN, debug: { reason: 'null error' } }
  }

  // Anthropic SDK authentication failure (401) — key is invalid or revoked
  if (err.status === 401 || err.name === 'AuthenticationError') {
    return { errorType: ERROR_TYPES.INVALID_API_KEY, debug: { status: err.status, message: err.message } }
  }

  // 403 can also indicate a permission/key issue — treat as invalid key
  if (err.status === 403) {
    return { errorType: ERROR_TYPES.INVALID_API_KEY, debug: { status: 403, message: err.message } }
  }

  // 404 from a model provider means the model name is not recognized.
  // This is the most common setup mistake with a custom provider.
  if (err.status === 404 || err.name === 'NotFoundError') {
    return { errorType: ERROR_TYPES.INVALID_MODEL, debug: { status: 404, message: err.message } }
  }

  // Rate limit (429)
  if (err.status === 429 || err.name === 'RateLimitError') {
    return { errorType: ERROR_TYPES.RATE_LIMIT, debug: { status: 429, message: err.message } }
  }

  // 5xx from the provider
  if (typeof err.status === 'number' && err.status >= 500 && err.status < 600) {
    return { errorType: ERROR_TYPES.SERVER_ERROR, debug: { status: err.status, message: err.message } }
  }

  // Transport-level failures. SDK surfaces these as APIConnectionError;
  // raw Node throws ENOTFOUND / ECONNREFUSED / ETIMEDOUT.
  const transportCodes = ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN']
  if (
    err.name === 'APIConnectionError' ||
    err.name === 'APIConnectionTimeoutError' ||
    err.name === 'TimeoutError' ||
    transportCodes.includes(err.code) ||
    transportCodes.includes(err.cause?.code)
  ) {
    return { errorType: ERROR_TYPES.NETWORK, debug: { code: err.code || err.cause?.code, message: err.message } }
  }

  // Filesystem errors surface with err.syscall / err.code
  const fsCodes = ['ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'EROFS', 'EISDIR']
  if (fsCodes.includes(err.code)) {
    return { errorType: ERROR_TYPES.FILESYSTEM, debug: { code: err.code, syscall: err.syscall, path: err.path } }
  }

  return { errorType: ERROR_TYPES.UNKNOWN, debug: { name: err.name, message: err.message } }
}

module.exports = {
  ERROR_TYPES,
  DEFAULT_USER_MESSAGES,
  sendOk,
  sendError,
  mapSdkError,
}
