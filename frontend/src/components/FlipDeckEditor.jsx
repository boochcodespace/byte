import { useState, useRef, useEffect } from 'react'
import { EditorField, EditorCard, EditorNotes, EditorActions } from './EditorParts'
import { VisualEditor } from './VisualFields'
import { checkCard } from '../lib/cardChecks.mjs'

// Editor for a flip card deck's words (D2, version 1: text only).
//
// You can change the front and back of each card and the deck's visual: its
// description, alt text, long description, and "decorative" with a reason (and
// draft alt text with Byte). You cannot add or remove cards yet.
//
// Same layout as the other editors (see EditorParts): labels above, one
// collapsible card per card, front and back side by side on a wide editor, a
// sticky Save bar. The writing notes are advisory and never block saving. The
// one blocker: a deck that describes a visual needs alt text or a decorative
// reason, so Byte never keeps an unlabeled visual.
//
// Props: artifact, busy, error, onSave(edits), onCancel, onDraftAlt(brief)

const TYPE_LABEL = { hook: 'Hook', content: 'Content', apply: 'Apply today' }

function startingDraft(artifact) {
  return {
    visual: artifact.visual_anchor_description || '',
    alt_text: artifact.alt_text || '',
    long_description: artifact.long_description || '',
    decorative: artifact.decorative === true,
    decorative_reason: artifact.decorative_reason || '',
    cards: (artifact.cards || []).map(c => ({ type: c.type, front: c.front || '', back: c.back || '' })),
  }
}

const excerpt = (t, n = 80) => {
  const s = (t || '').replace(/\s+/g, ' ').trim()
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

function FlipDeckEditor({ artifact, busy, error, onSave, onCancel, onDraftAlt }) {
  const [draft, setDraft] = useState(() => startingDraft(artifact))
  const [open, setOpen] = useState(() => (artifact.cards || []).map(() => true))
  const [attempted, setAttempted] = useState(false)
  const firstField = useRef(null)
  const id = artifact.folder || 'deck'

  const hasVisual = !!draft.visual.trim()
  const needsAlt = hasVisual && !draft.decorative && !draft.alt_text.trim()
  const needsReason = hasVisual && draft.decorative && !draft.decorative_reason.trim()

  useEffect(() => { firstField.current?.focus() }, [])

  const patchCard = (i, patch) => setDraft(d => ({ ...d, cards: d.cards.map((c, k) => (k === i ? { ...c, ...patch } : c)) }))
  const toggle = i => setOpen(o => o.map((v, k) => (k === i ? !v : v)))

  function submit(e) {
    e.preventDefault()
    if (needsAlt || needsReason) {
      setAttempted(true)
      setTimeout(() => document.getElementById(`${id}-visual-flag`)?.focus(), 0)
      return
    }
    onSave({
      visual_anchor_description: draft.visual,
      alt_text: draft.alt_text,
      long_description: draft.long_description,
      decorative: draft.decorative,
      decorative_reason: draft.decorative_reason,
      cards: draft.cards.map(c => ({ front: c.front, back: c.back })),
    })
  }

  const blocked = attempted && (needsAlt || needsReason)
    ? (needsAlt
      ? 'Save is blocked. The deck describes a visual, so it needs alt text, or mark the visual as decorative with a reason.'
      : 'Save is blocked. Say why the visual is decorative.')
    : ''

  return (
    <form className="ae" onSubmit={submit} aria-label="Edit flip card deck">
      <p className="ae-intro">
        You can change the words on each card and the deck's visual description and alt text. You cannot add or remove cards yet.
      </p>

      <section className="ae-card" aria-labelledby={`${id}-visual-h`}>
        <h3 className="ae-card-head" id={`${id}-visual-h`} style={{ padding: '10px 14px', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
          Deck visual
        </h3>
        <div className="ae-card-body">
          {(needsAlt || needsReason) && (
            <p className="ae-flag" id={`${id}-visual-flag`} tabIndex={-1}>
              <strong>Needs alt text.</strong>{' '}
              {needsReason
                ? 'The visual is marked decorative, but no reason is given. Say why it adds no meaning.'
                : 'This deck describes a visual, so it needs alt text, or mark it decorative with a reason.'}
            </p>
          )}
          <VisualEditor
            value={{ visual: draft.visual, alt_text: draft.alt_text, long_description: draft.long_description, decorative: draft.decorative, decorative_reason: draft.decorative_reason }}
            onChange={p => setDraft(d => ({
              ...d,
              ...('visual' in p ? { visual: p.visual } : {}),
              ...('alt_text' in p ? { alt_text: p.alt_text } : {}),
              ...('long_description' in p ? { long_description: p.long_description } : {}),
              ...('decorative' in p ? { decorative: p.decorative } : {}),
              ...('decorative_reason' in p ? { decorative_reason: p.decorative_reason } : {}),
            }))}
            busy={busy}
            onDraft={onDraftAlt}
          />
        </div>
      </section>

      {draft.cards.map((card, i) => {
        const notes = checkCard(card, draft.cards)
        const n = i + 1
        const status = [TYPE_LABEL[card.type] || card.type, notes.length ? `${notes.length} writing note${notes.length === 1 ? '' : 's'}` : null].filter(Boolean).join(', ')
        return (
          <EditorCard
            key={i}
            id={`${id}-c${i}`}
            title={`Card ${n}: ${excerpt(card.front) || '(no text)'}`}
            status={status}
            open={open[i]}
            onToggle={() => toggle(i)}
          >
            <div className="ae-cols">
              <EditorField context={`Card ${n}: `} label="Front" inputRef={i === 0 ? firstField : undefined} value={card.front} disabled={busy}
                onChange={e => patchCard(i, { front: e.target.value })} />
              <EditorField context={`Card ${n}: `} label="Back" value={card.back} disabled={busy}
                onChange={e => patchCard(i, { back: e.target.value })} />
            </div>
            <EditorNotes
              title={`Writing advice for card ${n} (advice only, never blocks saving)`}
              notes={notes}
              emptyText="No notes. This card follows the flip card checks Byte can run."
            />
          </EditorCard>
        )
      })}

      <EditorActions busy={busy} onCancel={onCancel} error={error} blocked={blocked} />
    </form>
  )
}

export default FlipDeckEditor
