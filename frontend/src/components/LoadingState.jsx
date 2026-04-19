import './LoadingState.css'

// LoadingState
//
// The one visible indicator used everywhere a backend call is in
// flight. Every page uses this — no bespoke spinners, no silent
// loading states.
//
// Props:
//   message  — "Generating your flip card deck...", "Saving...", etc.
//   subtle   — compact inline variant, for sidebars and small cards
//              (defaults to false → larger card-style block for
//              full-panel loading)
//   hint     — optional secondary line shown below the message, used
//              by the Generate flow to warn that Claude can take ~30s
//
// Why no prop for "where to render it": placement is the parent's
// job. This component is purely the visual primitive.

function LoadingState({ message, subtle = false, hint }) {
  return (
    <div
      className={`loading-state ${subtle ? 'loading-state-subtle' : 'loading-state-block'}`}
      role="status"
      aria-live="polite"
    >
      <span className="loading-spinner" aria-hidden="true" />
      <span className="loading-message">{message}</span>
      {hint && !subtle && <span className="loading-hint">{hint}</span>}
    </div>
  )
}

export default LoadingState
