import { useState } from 'react'

// ContextPanel
//
// A short form that steers ONE artifact block before it is generated. Every
// field is optional; leaving them all empty generates with the lesson
// defaults. Whatever is entered is stored on the block as
// generation_context, so Regenerate opens this panel again with the same
// values and they can be edited.
//
// It sits below the project style guide and the item-writing rules, and
// above the project custom instructions, for this block's content focus
// only. It cannot change voice, names, or how questions are written.
//
// Props:
//   type              — the block's artifact type (sets the count range)
//   initial           — the block's stored generation_context, if any
//   limits            — { [type]: { default, min, max } } from the API
//   lessonExperience  — the lesson's own level, shown as the default
//   busy              — true while a generation is running
//   submitLabel       — button text (default "Generate")
//   overwriteWarning  — optional text. When set, submitting first asks the
//                       user to confirm (used when regenerating would
//                       replace hand edits)
//   onSubmit(context) — called with the fields as typed
//   onCancel()        — closes the panel without generating

const EXPERIENCE = ['Novice', 'Practicing', 'Expert']
const COUNT_LABEL = {
  'flip-card-deck': 'Number of cards',
  'knowledge-check': 'Number of questions',
  'scenario-branching': 'Number of decisions',
  tabs: 'Number of tabs',
}

function ContextPanel({
  type,
  initial,
  limits,
  lessonExperience,
  busy,
  submitLabel = 'Generate',
  overwriteWarning,
  onSubmit,
  onCancel,
}) {
  const [focus, setFocus] = useState(initial?.focus || '')
  const [sourceSection, setSourceSection] = useState(initial?.source_section || '')
  const [count, setCount] = useState(initial?.count ? String(initial.count) : '')
  const [experience, setExperience] = useState(initial?.experience || '')
  const [notes, setNotes] = useState(initial?.notes || '')
  const [confirming, setConfirming] = useState(false)
  const isTabs = type === 'tabs'

  const size = limits?.[type]
  const counts = size
    ? Array.from({ length: size.max - size.min + 1 }, (_, i) => size.min + i)
    : []

  function handleSubmit(e) {
    e.preventDefault()
    if (overwriteWarning && !confirming) {
      setConfirming(true)
      return
    }
    onSubmit({
      focus,
      source_section: sourceSection,
      count: count ? Number(count) : undefined,
      experience,
      notes,
    })
  }

  return (
    <form className="context-panel" onSubmit={handleSubmit} aria-label="Generation context">
      <strong>Steer this block</strong>
      <p className="field-help">
        All fields are optional. This applies to this block only. It cannot change the project's
        voice, names, or how questions are written.
      </p>

      <div className="form-group">
        <label>
          {isTabs ? 'Instruction' : 'Focus'}
          <input
            type="text"
            placeholder={isTabs
              ? 'What to compare or layer, e.g. compare host, client, and server'
              : 'What this should emphasize, e.g. host, client, and server roles'}
            value={focus}
            onChange={e => setFocus(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </label>
      </div>

      <div className="form-group">
        <label>
          Source section
          <input
            type="text"
            placeholder="Which part of the sources to draw from, e.g. a heading"
            value={sourceSection}
            onChange={e => setSourceSection(e.target.value)}
            disabled={busy}
          />
        </label>
      </div>

      {size && (
        <div className="form-group">
          <label>
            {COUNT_LABEL[type] || 'Count'}
            <select value={count} onChange={e => setCount(e.target.value)} disabled={busy}>
              <option value="">{size.default ? `Default (${size.default})` : 'Let Byte decide'}</option>
              {counts.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
      )}

      <div className="form-group">
        <label>
          Experience level
          <select value={experience} onChange={e => setExperience(e.target.value)} disabled={busy}>
            <option value="">
              Lesson level{lessonExperience ? ` (${lessonExperience})` : ''}
            </option>
            {EXPERIENCE.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
      </div>

      <div className="form-group">
        <label>
          Notes
          <textarea
            rows={2}
            placeholder='e.g. use the mix-ups section for distractors'
            value={notes}
            onChange={e => setNotes(e.target.value)}
            disabled={busy}
          />
        </label>
      </div>

      {confirming && (
        <p className="status-message error" role="alert">{overwriteWarning}</p>
      )}

      <div className="lesson-actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? 'Generating...' : confirming ? 'Yes, replace my edits' : submitLabel}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={confirming ? () => setConfirming(false) : onCancel} disabled={busy}>
          {confirming ? 'Back' : 'Cancel'}
        </button>
      </div>
    </form>
  )
}

export default ContextPanel
