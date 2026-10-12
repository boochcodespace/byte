import { useState, useRef, useEffect } from 'react'
import GrowTextarea from './GrowTextarea'
import { checkItem, keyCount } from '../lib/itemChecks.mjs'

// Editor for a knowledge check's words (D2, version 1: text only).
//
// You can change the task setup, the apply-today line, each question's stem
// (and its scenario, if it has one), each option's text and explanation, and
// which option is the key. You cannot add or remove questions or options yet.
//
// Options appear in STORED order with their letters. Learners see them in a
// shuffled order, so the letters here are for the author only.
//
// Exactly one key per question. An older file can have none or several; those
// questions are flagged "Needs a key" and Save is refused until each has one.
// The item-writing notes are advisory: they never block saving.
//
// Props: artifact (the saved artifact), busy, error, onSave(edits), onCancel

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

function KnowledgeCheckEditor({ artifact, busy, error, onSave, onCancel }) {
  const [draft, setDraft] = useState(() => startingDraft(artifact))
  const [attempted, setAttempted] = useState(false)
  const firstField = useRef(null)
  const needsKey = draft.items.map(keyCount).map(n => n !== 1)

  useEffect(() => { firstField.current?.focus() }, [])

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

  function submit(e) {
    e.preventDefault()
    const bad = needsKey.findIndex(Boolean)
    if (bad !== -1) {
      // Refuse to save, say why, and move to the first question that needs a key.
      setAttempted(true)
      document.getElementById(`${artifact.folder}-q${bad}-flag`)?.focus()
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

  return (
    <form className="artifact-editor" onSubmit={submit} aria-label="Edit knowledge check">
      <p className="field-help">
        You can change the words and which option is the key. You cannot add or remove questions or options yet.
        Learners see each question's options in a shuffled order, so the letters here are for you only.
      </p>

      <div className="form-group">
        <label>
          Task setup
          <GrowTextarea ref={firstField} rows={2} value={draft.setup} onChange={e => setDraft(d => ({ ...d, setup: e.target.value }))} disabled={busy} />
        </label>
      </div>
      <div className="form-group">
        <label>
          Apply today
          <GrowTextarea rows={2} value={draft.apply_today} onChange={e => setDraft(d => ({ ...d, apply_today: e.target.value }))} disabled={busy} />
        </label>
      </div>

      {draft.items.map((item, i) => {
        const notes = checkItem(item)
        const keys = keyCount(item)
        return (
          <fieldset key={i} className="artifact-editor-item" disabled={busy}>
            <legend>Question {i + 1}</legend>

            {needsKey[i] && (
              <p className="a11y-needs-key" id={`${artifact.folder}-q${i}-flag`} tabIndex={-1}>
                <strong>Needs a key.</strong>{' '}
                {keys === 0 ? 'No option is marked as the key.' : `${keys} options are marked as the key.`}{' '}
                Choose the one strongest answer below.
              </p>
            )}

            {item.scenario !== undefined && (
              <div className="form-group">
                <label>
                  Question {i + 1} scenario
                  <GrowTextarea rows={2} value={item.scenario} onChange={e => patchItem(i, { scenario: e.target.value })} />
                </label>
              </div>
            )}
            <div className="form-group">
              <label>
                Question {i + 1} text
                <GrowTextarea rows={2} value={item.stem} onChange={e => patchItem(i, { stem: e.target.value })} />
              </label>
            </div>

            <div role="group" aria-label={`Question ${i + 1} options`} className="artifact-editor-options">
              {item.options.map((o, j) => (
                <div key={j} className="artifact-editor-option">
                  <h3 className="artifact-editor-option-title">Option {LETTERS[j]}</h3>
                  <div className="form-group">
                    <label>
                      Question {i + 1}, option {LETTERS[j]} text
                      <GrowTextarea rows={2} value={o.text} onChange={e => patchOption(i, j, { text: e.target.value })} />
                    </label>
                  </div>
                  <div className="form-group">
                    <label>
                      Question {i + 1}, option {LETTERS[j]} explanation
                      <GrowTextarea rows={2} value={o.rationale} onChange={e => patchOption(i, j, { rationale: e.target.value })} />
                    </label>
                  </div>
                  <label className="artifact-editor-key">
                    <input
                      type="radio"
                      name={`${artifact.folder}-key-${i}`}
                      checked={keys === 1 && o.correct}
                      onChange={() => chooseKey(i, j)}
                    />{' '}
                    Question {i + 1}: option {LETTERS[j]} is the key
                  </label>
                </div>
              ))}
            </div>

            <div className="artifact-editor-notes">
              <h3 className="artifact-editor-notes-title">Writing notes for question {i + 1} (advice only, never blocks saving)</h3>
              {notes.length === 0 ? (
                <p className="field-help">No notes. This question follows the item-writing checks Byte can run.</p>
              ) : (
                <ul>
                  {notes.map((n, k) => <li key={k}>{n.message}</li>)}
                </ul>
              )}
            </div>
          </fieldset>
        )
      })}

      {attempted && keyProblems.length > 0 && (
        <p className="status-message error" role="alert">
          Save is blocked. {keyProblems.length === 1 ? `Question ${keyProblems[0]} needs` : `Questions ${keyProblems.join(', ')} need`} exactly one option marked as the key.
        </p>
      )}
      {error && <p className="status-message error" role="alert">{error}</p>}

      <div className="lesson-actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? 'Saving...' : 'Save changes'}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  )
}

export default KnowledgeCheckEditor
