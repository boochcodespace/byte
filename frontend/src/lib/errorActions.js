// frontend/src/lib/errorActions.js
//
// Default action hints per errorType. Pages use this to decide which
// props to hand to <ErrorState />. Keeping the mapping here (instead
// of in each page) means a change like "provider errors also link to
// docs" is a single-file edit.
//
// A null value for `actionHref` means "use onRetry instead." Pages
// usually supply onRetry themselves since it needs a reference to
// the specific call that failed.

// Errors the user fixes on the Settings page: a missing or rejected
// key, or a model name the provider does not recognize.
const SETTINGS_ERRORS = new Set(['missing_api_key', 'invalid_api_key', 'invalid_model'])

export function isSettingsError(errorType) {
  return SETTINGS_ERRORS.has(errorType)
}

// Returns the action-related props for a given error. Pages spread
// these into <ErrorState /> alongside their own onRetry.
//
//   <ErrorState
//     message={error.userMessage}
//     onRetry={handleGenerate}
//     {...actionPropsFor(error.errorType)}
//   />
export function actionPropsFor(errorType) {
  if (isSettingsError(errorType)) {
    return { actionHref: '/settings', actionLabel: 'Go to Settings' }
  }
  return {}
}
