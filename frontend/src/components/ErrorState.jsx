import { Link } from 'react-router-dom'
import './ErrorState.css'

// ErrorState
//
// The one error-display primitive used everywhere. Every error path
// routes through this so the user always sees the same shape: a
// clear message + at least one recoverable action.
//
// The "every error is recoverable" principle: an error with no action
// is a dead end. If you find yourself wanting to pass neither
// onRetry nor actionHref, you likely want `onRetry={() => location.reload()}`
// — explicit is better than silent.
//
// Props:
//   message      — the human-readable message. Usually envelope.userMessage.
//   onRetry      — optional. If set, renders a Retry button.
//   actionLabel  — optional. Label for actionHref link (default "Go").
//   actionHref   — optional. If set, renders a react-router Link.
//                  Use "/settings" for API-key errors.
//
// Passing both onRetry and actionHref is fine — e.g. an invalid API
// key might offer both "Go to Settings" and "Retry" if the user
// corrected the key in another tab.

function ErrorState({ message, onRetry, actionLabel = 'Go', actionHref }) {
  return (
    <div className="error-state" role="alert">
      <span className="error-state-icon" aria-hidden="true">⚠</span>
      <div className="error-state-body">
        <p className="error-state-message">{message}</p>
        {(onRetry || actionHref) && (
          <div className="error-state-actions">
            {actionHref && (
              <Link to={actionHref} className="btn btn-secondary btn-sm">
                {actionLabel}
              </Link>
            )}
            {onRetry && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onRetry}
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default ErrorState
