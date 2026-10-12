import { useState, useRef, useEffect } from 'react'
import { EditorField, EditorCard, EditorNotes, EditorActions } from './EditorParts'
import { checkItem, keyCount } from '../lib/itemChecks.mjs'

// Editor for a knowledge check's words (D2, version 1: text only).
//
// You can change the task setup, the apply-today line, each question's text
// (and its scenario, if it has one), each option's text and explanation, and
// which option is the key. You cannot add or remove questions or options yet.
//
// Layout (shared with the other editors, see EditorParts): labels above their
// fields, one collapsible card per question (all open by default), each option
// a row with its text and explanation side by side on a wide editor, a sticky
// Save and Cancel bar. A collapsed card still shows its question and a status
// ("Key: A", "Needs a key", "2 writing notes").
//
// Options appear in STORED order with their letters. Learners see them in a
// shuffled order, so the letters here are for the author only.
//
// Exactly one key per question. An older file can have none or several; those
// questions are flagged "Needs a key" and Save is refused until each has one.
// The writing notes are advisory: they never block saving.
//
// Props: artifact, busy, error, onSave(edits), onCancel,
//        focusQuestion (0-based; open the editor at that question)

const LETTERS = 'ABCDEFGH'

function startingDraft(artifact) {
  return {
    setup: artifact.setup || '',
    apply_today: artifact.apply_today || '',
    items: (artifact.items || []).map(it => ({
      stem: it.stem || '',
      scenario: it.scenario,
      options: (it.options || []).map(o => ({ text: o.text || '', rationale: o.rationale || '', correct: o.correct === true })),
    })),
  }
}

const excerpt = (t, n = 90) => {
  const s = (t || '').replace(/\s+/g, ' ').trim()
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

function KnowledgeCheckEditor({ artifact, busy, error, onSave, onCancel, focusQuestion = null }) {
  const [draft, setDraft] = useState(() => startingDraft(artifact))
  const [open, setOpen] = useState(() => (artifact.items || []).map(() => true))
  const [attempted, setAttempted] = useState(false)
  const firstField = useRef(null)
  const id = artifact.folder || 'kc'
  const needsKey = draft.items.map(keyCount).map(n => n !== 1)

  // Open at the requested question (the accessibility checker's Fix link), or
  // in the first field.
  useEffect(() => {
    if (focusQuestion !== null && focusQuestion !== undefined) {
      const target = document.getElementById(`${id}-q${focusQuestion}-flag`) || document.getElementById(`${id}-q${focusQuestion}-btn`)
      target?.focus()
      target?.scrollIntoView({ block: 'center' })
    } else {
      firstField.current?.focus()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const patchItem = (i, patch) =>
    setDraft(d => ({ ...d, items: d.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) }))
  const patchOption = (i, j, patch) =>
    setDraft(d => ({
      ...d,
      items: d.items.map((it, k) => (k === i
        ? { ...it, options: it.options.map((o, m) => (m === j ? { ...o, ...patch } : o)) }
        : it)),
    }))
  const chooseKey = (i, j) =>
    setDraft(d => ({
      ...d,
      items: d.items.map((it, k) => (k === i
        ? { ...it, options: it.options.map((o, m) => ({ ...o, correct: m === j })) }
        : it)),
    }))
  const toggle = i => setOpen(o => o.map((v, k) => (k === i ? !v : v)))

  function submit(e) {
    e.preventDefault()
    const bad = needsKey.findIndex(Boolean)
    if (bad !== -1) {
      // Refuse to save, say why, and move to the first question that needs a key.
      setAttempted(true)
      setOpen(o => o.map((v, k) => (k === bad ? true : v)))
      setTimeout(() => document.getElementById(`${id}-q${bad}-flag`)?.focus(), 0)
      return
    }
    onSave({
      setup: draft.setup,
      apply_today: draft.apply_today,
      items: draft.items.map(it => ({
        stem: it.stem,
        ...(it.scenario !== undefined ? { scenario: it.scenario } : {}),
        options: it.options.map(o => ({ text: o.text, rationale: o.rationale, correct: o.correct })),
      })),
    })
  }

  const keyProblems = needsKey.map((n, i) => (n ? i + 1 : null)).filter(Boolean)
  const blocked = attempted && keyProblems.length > 0
    ? `Save is blocked. ${keyProblems.length === 1 ? `Question ${keyProblems[0]} needs` : `Questions ${keyProblems.join(', ')} need`} exactly one option marked as the key.`
    : ''

  return (
    <form className="ae" onSubmit={submit} aria-label="Edit knowledge check">
      <p className="ae-intro">
        You can change the words and which option is the key. You cannot add or remove questions or options yet.
        Learners see each question's options in a shuffled order, so the letters here are for you only.
      </p>

      <EditorField label="Task setup" value={draft.setup} inputRef={firstField} disabled={busy}
        onChange={e => setDraft(d => ({ ...d, setup: e.target.value }))} />
      <EditorField label="Apply today" value={draft.apply_today} disabled={busy}
        onChange={e => setDraft(d => ({ ...d, apply_today: e.target.value }))} />

      {draft.items.map((item, i) => {
        const notes = checkItem(item)
        const keys = keyCount(item)
        const keyIdx = keys === 1 ? item.options.findIndex(o => o.correct) : -1
        const status = [
          keys === 1 ? `Key: ${LETTERS[keyIdx]}` : 'Needs a key',
          notes.length ? `${notes.length} writing note${notes.length === 1 ? '' : 's'}` : null,
        ].filter(Boolean).join(', ')
        const q = i + 1
        return (
          <EditorCard
            key={i}
            id={`${id}-q${i}`}
            title={`Question ${q}: ${excerpt(item.stem) || '(no text)'}`}
            status={status}
            open={open[i]}
            onToggle={() => toggle(i)}
          >
            <fieldset className="ae-plain" disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <legend className="sr-only">Question {q}</legend>

              {needsKey[i] && (
                <p className="ae-flag" id={`${id}-q${i}-flag`} tabIndex={-1}>
                  <strong>Needs a key.</strong>{' '}
                  {keys === 0 ? 'No option is marked as the key.' : `${keys} options are marked as the key.`}{' '}
                  Choose the one strongest answer below.
                </p>
              )}

              {item.scenario !== undefined && (
                <EditorField context={`Question ${q}: `} label="Scenario" value={item.scenario}
                  onChange={e => patchItem(i, { scenario: e.target.value })} />
              )}
              <EditorField context={`Question ${q}: `} label="Question text" value={item.stem}
                onChange={e => patchItem(i, { stem: e.target.value })} />

              <EditorNotes
                title={`Writing advice for question ${q} (advice only, never blocks saving)`}
                notes={notes}
                emptyText="No notes. This question follows the item-writing checks Byte can run."
              />

              <fieldset className="ae-options">
                <legend>
                  Which option is the key? <span className="sr-only">(question {q})</span>
                </legend>
                {item.options.map((o, j) => (
                  <div key={j} className="ae-option">
                    <div className="ae-option-head">
                      <label className="ae-key">
                        <input
                          type="radio"
                          name={`${id}-key-${i}`}
                          checked={keys === 1 && o.correct}
                          onChange={() => chooseKey(i, j)}
                        />
                        <span>Option {LETTERS[j]}</span>
                      </label>
                      {keys === 1 && o.correct && <span className="ae-key-badge">Key</span>}
                    </div>
                    <div className="ae-cols">
                      <EditorField context={`Question ${q}, option ${LETTERS[j]}: `} label="Answer text" value={o.text}
                        onChange={e => patchOption(i, j, { text: e.target.value })} />
                      <EditorField context={`Question ${q}, option ${LETTERS[j]}: `} label="Explanation" value={o.rationale}
                        onChange={e => patchOption(i, j, { rationale: e.target.value })} />
                    </div>
                  </div>
                ))}
              </fieldset>
            </fieldset>
          </EditorCard>
        )
      })}

      <EditorActions busy={busy} onCancel={onCancel} error={error} blocked={blocked} />
    </form>
  )
}

export default KnowledgeCheckEditor
