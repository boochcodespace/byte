import { useId } from 'react'
import GrowTextarea from './GrowTextarea'
import './editor.css'

// The building blocks every artifact editor shares (D2), so the knowledge
// check, flip deck, and scenario editors all look and behave the same.
//
//   EditorField    a label ABOVE a growing text box. `context` is read by screen
//                  readers only ("Question 1, option A: "), so every field has a
//                  unique name that still starts with the visible label.
//   EditorCard     a section that collapses and expands (open by default). The
//                  header shows a title and a status line, and is one button.
//   EditorNotes    advisory writing notes under a question or card
//   EditorActions  the sticky Save / Cancel bar

export function EditorField({ context = '', label, hint, value, onChange, disabled, inputRef, rows = 2 }) {
  const id = useId()
  return (
    <div className="ae-field">
      <label htmlFor={id}>
        {context && <span className="sr-only">{context}</span>}
        {label}
      </label>
      {hint && <p className="ae-field-hint" id={`${id}-hint`}>{hint}</p>}
      <GrowTextarea
        id={id}
        ref={inputRef}
        rows={rows}
        value={value}
        onChange={onChange}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
    </div>
  )
}

export function EditorCard({ id, title, status, open, onToggle, children, level = 3, headerRef }) {
  return (
    <section className="ae-card">
      {/* the heading holds one button, so the card is both a heading and a toggle */}
      {level === 3 ? (
        <h3 className="ae-card-head">{toggle()}</h3>
      ) : (
        <h4 className="ae-card-head">{toggle()}</h4>
      )}
      <div id={`${id}-panel`} className="ae-card-body" hidden={!open} role="group" aria-labelledby={`${id}-btn`}>
        {children}
      </div>
    </section>
  )

  function toggle() {
    return (
      <button
        type="button"
        id={`${id}-btn`}
        ref={headerRef}
        className="ae-card-toggle"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={onToggle}
      >
        <span className="ae-card-title">{title}</span>
        {status && <span className="ae-card-status">{status}</span>}
      </button>
    )
  }
}

export function EditorNotes({ title, notes, emptyText }) {
  return (
    <div className="ae-notes">
      <h4 className="ae-notes-title">{title}</h4>
      {notes.length === 0 ? (
        <p className="field-help">{emptyText}</p>
      ) : (
        <ul>{notes.map((n, k) => <li key={k}>{n.message}</li>)}</ul>
      )}
    </div>
  )
}

export function EditorActions({ busy, onCancel, error, blocked, saveLabel = 'Save changes' }) {
  return (
    <div className="ae-actions">
      {blocked && <p className="status-message error ae-error" role="alert">{blocked}</p>}
      {error && <p className="status-message error ae-error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
        {busy ? 'Saving...' : saveLabel}
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
    </div>
  )
}
