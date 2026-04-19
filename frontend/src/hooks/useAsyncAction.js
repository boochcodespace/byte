import { useCallback, useRef, useState } from 'react'

// useAsyncAction
//
// Wraps any async operation in a consistent { loading, error, run,
// clearError } contract so every page handles loading + errors the
// same way.
//
// How to use:
//
//   const { loading, error, run, clearError } = useAsyncAction()
//
//   async function handleGenerate() {
//     const result = await run(() => api.post('/api/...', body))
//     if (result !== undefined) {
//       // success: result is the unwrapped .data from the envelope
//     }
//     // on error, `error` will be set to { errorType, userMessage, debug }
//   }
//
// Why an in-flight guard: two async calls that resolve out of order
// would produce a classic React race — a stale response can clobber a
// fresh one. Instead of layering last-write-wins bookkeeping, we
// simply refuse to start a second call while one is in flight. This
// also naturally prevents double-submits from rapid clicks without
// needing a debounce timer.
//
// The guard uses a ref (not state) so reads are synchronous; reading
// state here would race with the state update from the previous call.
//
// `error` is either null or the thrown envelope from apiFetch.

export function useAsyncAction() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const inFlightRef = useRef(false)

  const clearError = useCallback(() => setError(null), [])

  const run = useCallback(async (fn) => {
    if (inFlightRef.current) return undefined
    inFlightRef.current = true
    setLoading(true)
    setError(null)
    try {
      const result = await fn()
      return result
    } catch (err) {
      // err is expected to be an envelope thrown by apiFetch. If it's
      // something else (a bug in the callback), wrap it.
      if (err && err.errorType) {
        setError(err)
      } else {
        setError({
          errorType: 'unknown',
          userMessage: 'Something went wrong. Please try again.',
          debug: { message: err?.message || String(err) },
        })
      }
      return undefined
    } finally {
      inFlightRef.current = false
      setLoading(false)
    }
  }, [])

  return { loading, error, run, clearError }
}
