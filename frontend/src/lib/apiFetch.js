// frontend/src/lib/apiFetch.js
//
// Single entry point for every call to the Byte backend API.
// Reason it exists: the backend speaks our envelope contract
// ({ ok: true, data } | { ok: false, errorType, userMessage, debug }),
// and we want every page to consume that shape identically. apiFetch
// turns the envelope — plus any transport failure that happens before
// the server even responds — into a consistent throw-or-return.
//
//   throws:   { errorType, userMessage, debug }   — on failure
//   returns:  <data>                              — on success
//
// A thrown object is not an Error instance: it's the envelope body, so
// pages/hooks can branch on .errorType directly without unwrapping.
//
// Transport errors (no response, CORS, DNS, offline) map to a
// synthesised `network` envelope so the UI has the same shape to
// consume whether the server returned an error or the request never
// reached the server at all.

export const FRONTEND_ERROR_TYPES = Object.freeze({
  NETWORK: 'network',
  UNKNOWN: 'unknown',
})

function makeNetworkError(err) {
  return {
    errorType: FRONTEND_ERROR_TYPES.NETWORK,
    userMessage: 'Could not reach the backend. Check that it is running and try again.',
    debug: { message: err?.message },
  }
}

export async function apiFetch(url, options = {}) {
  let res
  try {
    res = await fetch(url, options)
  } catch (err) {
    // Transport-level failure (offline, DNS, refused). No response body.
    throw makeNetworkError(err)
  }

  let body
  try {
    body = await res.json()
  } catch {
    // Server returned something non-JSON (e.g. an HTML error page from
    // a proxy). Treat as unknown rather than guessing.
    throw {
      errorType: FRONTEND_ERROR_TYPES.UNKNOWN,
      userMessage: 'The backend returned an unexpected response. Please try again.',
      debug: { status: res.status },
    }
  }

  // Envelope shape — normal path
  if (body && typeof body === 'object' && 'ok' in body) {
    if (body.ok) return body.data
    throw {
      errorType: body.errorType || FRONTEND_ERROR_TYPES.UNKNOWN,
      userMessage: body.userMessage || 'Something went wrong. Please try again.',
      debug: body.debug,
    }
  }

  // Defensive: should not happen once the whole backend is on the envelope,
  // but if a legacy endpoint slipped through, surface something useful.
  throw {
    errorType: FRONTEND_ERROR_TYPES.UNKNOWN,
    userMessage: 'The backend returned an unexpected response shape.',
    debug: { body },
  }
}

// Convenience wrappers. Bodies are JSON.stringified automatically when
// passed as a plain object; FormData (file upload) is passed through
// unchanged — the browser sets the multipart boundary itself.

function isFormData(x) {
  return typeof FormData !== 'undefined' && x instanceof FormData
}

function buildInit(method, body) {
  if (body === undefined) return { method }
  if (isFormData(body)) return { method, body }
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export const api = {
  get:    (url)                => apiFetch(url),
  post:   (url, body)          => apiFetch(url, buildInit('POST', body)),
  put:    (url, body)          => apiFetch(url, buildInit('PUT', body)),
  delete: (url)                => apiFetch(url, { method: 'DELETE' }),
}
