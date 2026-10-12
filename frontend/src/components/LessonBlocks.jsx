import { useState, useRef, useEffect } from 'react'
import GrowTextarea from './GrowTextarea'
import { VisualEditor, VisualDisplay } from './VisualFields'
import { getRenderer, getTypeMeta } from '../artifact-renderers/registry'
import LoadingState from './LoadingState'

// The blocks a lesson is made of.
//
//   TextBlock      hook, chunk, apply, and recall blocks (plain text)
//   ArtifactBlock  a flip deck, knowledge check, or scenario slot. A slot
//                  is either PROPOSED (nothing generated yet), READY (a
//                  reference to a real artifact, rendered in place), or
//                  UNAVAILABLE (its artifact is gone; the block is kept).
//
// An artifact block shows the artifact through the same renderer used on
// the source page. The renderer keeps the learner's progress in its own
// state, so the `artifact` object passed in must stay the same object
// between refreshes. LessonDetail guarantees that (see lib/stabilize.js).

// Body text is plain: paragraphs separated by blank lines.
export { GrowTextarea }

export function Paragraphs({ text }) {
  return (text || '')
    .split(/\n{2,}/)
    .filter(p => p.trim())
    .map((p, i) => <p key={i}>{p.trim()}</p>)
}

const KIND_LABEL = { hook: 'Start here', chunk: null, apply: 'Apply today' }

// Inline editor for one text block. Fields shown depend on the kind:
// body for all, title and visual note for chunks, answer for recall.
export function TextEditor({ block, onSave, onCancel, busy, saveLabel = 'Save', onDraftAlt }) {
  const [title, setTitle] = useState(block.title || '')
  const [body, setBody] = useState(block.body || '')
  const [vis, setVis] = useState({
    visual: block.visual || '',
    alt_text: block.alt_text || '',
    long_description: block.long_description || '',
    decorative: block.decorative === true,
    decorative_reason: block.decorative_reason || '',
  })
  const [answer, setAnswer] = useState(block.answer || '')
  const isRecall = block.kind === 'recall'

  function save(e) {
    e.preventDefault()
    onSave({
      body,
      ...(block.kind === 'chunk' ? { title, ...vis } : {}),
      ...(isRecall ? { answer } : {}),
    })
  }

  return (
    <form className="tabs-editor" onSubmit={save} aria-label={`Edit ${block.kind} block`}>
      {block.kind === 'chunk' && (
        <div className="form-group">
          <label>
            Title
            <input type="text" value={title} maxLength={120} onChange={e => setTitle(e.target.value)} disabled={busy} autoFocus />
          </label>
        </div>
      )}
      <div className="form-group">
        <label>
          {isRecall ? 'Recall question' : 'Text'}
          <textarea rows={isRecall ? 3 : 6} value={body} onChange={e => setBody(e.target.value)} disabled={busy} autoFocus={block.kind !== 'chunk'} />
        </label>
      </div>
      {block.kind === 'chunk' && (
        <VisualEditor value={vis} onChange={p => setVis(v => ({ ...v, ...p }))} busy={busy} onDraft={onDraftAlt} />
      )}
      {isRecall && (
        <div className="form-group">
          <label>
            Answer
            <textarea rows={3} value={answer} onChange={e => setAnswer(e.target.value)} disabled={busy} />
          </label>
        </div>
      )}
      <div className="lesson-actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? 'Saving...' : saveLabel}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  )
}

// Props:
//   block, busy, disabled   the block, this block working, any block working
//   editing / onEdit / onSave / onCancelEdit   inline editing
//   onRemove, removeMessage   confirm text for Remove
//   canRemove               false for the last hook (shown as a note)
//   children                errors or panels under the block
export function TextBlock({ block, busy, disabled, editing, onEdit, onSave, onCancelEdit, onGenerate, onRemove, removeMessage, canRemove = true, onDraftAlt, label, children }) {
  const [showAnswer, setShowAnswer] = useState(false)
  const locked = busy || disabled
  const badge = block.edited && <span className="lesson-badge">Edited by you</span>
  const actions = !editing && onEdit && (
    <div className="lesson-actions">
      <button type="button" className="btn btn-secondary btn-sm" onClick={onEdit} disabled={locked}
        data-focus-key={`edit:${block.id}`}
        aria-label={label ? `Edit ${label}` : undefined}>
        Edit
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onGenerate} disabled={locked}
        data-focus-key={`regen:${block.id}`}
        aria-label={label ? `Regenerate ${label}` : undefined}>
        Regenerate
      </button>
      {canRemove ? (
        <RemoveControl
          onRemove={onRemove}
          locked={locked}
          label={label}
          message={removeMessage || (block.edited
            ? 'Remove this block? Your edits will be lost.'
            : 'Remove this block from the lesson?')}
        />
      ) : (
        <span className="field-help">The hook can't be removed. Edit it instead.</span>
      )}
    </div>
  )
  const spinner = busy && !editing && (
    <LoadingState subtle message="Rewriting this block..." hint="This may take up to 30 seconds." />
  )
  const generatedWith = !editing && contextSummary(block.generation_context) && (
    <p className="lesson-proposal-note">Generated with: {contextSummary(block.generation_context)}</p>
  )
  const editor = editing && (
    <TextEditor block={block} onSave={onSave} onCancel={onCancelEdit} busy={busy} onDraftAlt={onDraftAlt} />
  )

  if (block.kind === 'recall') {
    return (
      <div className="lesson-block lesson-block-recall">
        <div className="lesson-label">
          Day {block.recall_day} recall
          {badge}
          <span className="lesson-minutes">not counted in lesson time</span>
        </div>
        {editor || (
          <>
            <p className="lesson-recall-question">{block.body}</p>
            {showAnswer ? (
              <div className="lesson-recall-answer">
                <div className="lesson-label">Answer</div>
                <p>{block.answer}</p>
              </div>
            ) : (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAnswer(true)}
                aria-label={label ? `Show answer, ${label}` : undefined}>
                Show answer
              </button>
            )}
          </>
        )}
        {generatedWith}
        {actions}
        {spinner}
        {children}
      </div>
    )
  }

  return (
    <div className={`lesson-block lesson-block-${block.kind}`}>
      {(KIND_LABEL[block.kind] || block.edited) && (
        <div className="lesson-label">
          {KIND_LABEL[block.kind]}
          {badge}
          {KIND_LABEL[block.kind] && <span className="lesson-minutes">{block.minutes} min</span>}
        </div>
      )}
      {editor || (
        <>
          {block.kind === 'chunk' && (
            <h2 className="lesson-chunk-title">
              {block.title}
              <span className="lesson-minutes">{block.minutes} min</span>
            </h2>
          )}
          <div className="lesson-body">
            <Paragraphs text={block.body} />
          </div>
          {block.kind === 'chunk' && <VisualDisplay item={block} />}
        </>
      )}
      {generatedWith}
      {actions}
      {spinner}
      {children}
    </div>
  )
}

// Remove with a short confirmation. Removing takes the BLOCK out of the
// lesson only; the artifact itself stays in the project and is still
// offered by the picker.
export function RemoveControl({
  onRemove,
  locked,
  label,
  message = 'Remove this from the lesson? The artifact stays in your project.',
}) {
  const [confirming, setConfirming] = useState(false)
  const removeBtn = useRef(null)
  const cameFromCancel = useRef(false)
  useEffect(() => {
    if (!confirming && cameFromCancel.current) { cameFromCancel.current = false; removeBtn.current?.focus() }
  }, [confirming])
  if (!confirming) {
    return (
      <button type="button" ref={removeBtn} className="btn btn-secondary btn-sm" onClick={() => setConfirming(true)} disabled={locked}
        aria-label={label ? `Remove ${label}` : undefined}>
        Remove
      </button>
    )
  }
  return (
    <span className="delete-confirm" role="group" aria-label={label ? `Confirm removing ${label}` : 'Confirm removing'}>
      <span>{message}</span>
      <button type="button" className="btn btn-danger btn-sm" onClick={onRemove} disabled={locked}
        aria-label={label ? `Yes, remove ${label}` : undefined}>
        Yes, remove
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => { cameFromCancel.current = true; setConfirming(false) }} disabled={locked}
        aria-label={label ? `Cancel, keep ${label}` : undefined}>
        Cancel
      </button>
    </span>
  )
}

// Replace offers two choices: pick another existing artifact, or generate
// a new one. The artifact being replaced stays in the project.
function ReplaceControl({ onPickExisting, onGenerate, locked, label }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)} disabled={locked}
        aria-label={label ? `Replace ${label}` : undefined}>
        Replace
      </button>
    )
  }
  return (
    <span className="delete-confirm" role="group" aria-label={label ? `Replace ${label} with` : 'Replace with'}>
      <span>Replace with:</span>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => { setOpen(false); onPickExisting() }} disabled={locked}>
        Pick another existing
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setOpen(false); onGenerate() }} disabled={locked}>
        Generate a new one
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)} disabled={locked}>
        Cancel
      </button>
    </span>
  )
}

// One line describing the context a block was generated with, or '' if none.
export function contextSummary(ctx) {
  if (!ctx) return ''
  const parts = []
  if (ctx.focus) parts.push(`focus "${ctx.focus}"`)
  if (ctx.source_section) parts.push(`source section "${ctx.source_section}"`)
  if (ctx.count) parts.push(`count ${ctx.count}`)
  if (ctx.experience) parts.push(`${ctx.experience} level`)
  if (ctx.notes) parts.push(`notes "${ctx.notes.length > 80 ? ctx.notes.slice(0, 80) + '…' : ctx.notes}"`)
  return parts.join(', ')
}

// children: the context panel, the artifact picker, and/or an error,
// rendered under the block.
export function ArtifactBlock({
  block,
  artifact,
  busy,
  disabled,
  onGenerate,
  onPickExisting,
  onRemove,
  removeMessage,
  label,
  children,
}) {
  const meta = getTypeMeta(block.artifact_type)
  // `busy` shows this block's spinner; `disabled` also locks every other
  // block's buttons while any action is running (one action at a time).
  const locked = busy || disabled
  const spinner = busy && (
    <LoadingState
      subtle
      message={`Generating your ${meta.label.toLowerCase()}...`}
      hint="This may take up to 30 seconds."
    />
  )

  if (block.state === 'ready' && artifact && !block.unavailable) {
    const Renderer = getRenderer(block.artifact_type)
    return (
      <div className="lesson-block lesson-artifact">
        <div className="lesson-label">
          <span aria-hidden="true">{meta.icon}</span> {meta.label}
          <span className="lesson-minutes">{block.minutes} min</span>
        </div>
        {/* The renderer owns the learner's progress. It only resets if
            `artifact` changes identity or this key changes. */}
        <Renderer key={`${block.id}:${block.ref.source}/${block.ref.artifact}`} artifact={artifact} />
        {contextSummary(block.generation_context) && (
          <p className="lesson-proposal-note">Generated with: {contextSummary(block.generation_context)}</p>
        )}
        <div className="lesson-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onGenerate} disabled={locked}
            data-focus-key={`regen:${block.id}`}
            aria-label={label ? `Regenerate ${label}` : undefined}>
            Regenerate
          </button>
          <ReplaceControl onPickExisting={onPickExisting} onGenerate={onGenerate} locked={locked} label={label} />
          <RemoveControl onRemove={onRemove} locked={locked} label={label} message={removeMessage} />
        </div>
        {spinner}
        {children}
      </div>
    )
  }

  if (block.unavailable || (block.state === 'ready' && !artifact)) {
    return (
      <div className="lesson-block lesson-unavailable">
        <div className="lesson-label"><span aria-hidden="true">{meta.icon}</span> {meta.label}</div>
        <p>
          This artifact is no longer available. Your lesson is unchanged and nothing was deleted.
        </p>
        <div className="lesson-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={onPickExisting} disabled={locked}
            data-focus-key={`regen:${block.id}`}
            aria-label={label ? `Pick another for ${label}` : undefined}>
            Pick another
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onGenerate} disabled={locked}
            aria-label={label ? `Generate a new one for ${label}` : undefined}>
            Generate a new one
          </button>
          <RemoveControl onRemove={onRemove} locked={locked} label={label} message={removeMessage} />
        </div>
        {spinner}
        {children}
      </div>
    )
  }

  // proposed
  return (
    <div className="lesson-block lesson-proposal">
      <div className="lesson-label">
        <span aria-hidden="true">{meta.icon}</span> Suggested: {meta.label}
        <span className="lesson-minutes">about {block.minutes} min</span>
      </div>
      <p className="lesson-proposal-note">{block.placement_note}</p>
      <div className="lesson-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={onGenerate} disabled={locked}
          data-focus-key={`regen:${block.id}`}
          aria-label={label ? `Generate for this lesson: ${label}` : undefined}>
          Generate for this lesson
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onPickExisting} disabled={locked}
          aria-label={label ? `Pick existing for ${label}` : undefined}>
          Pick existing
        </button>
        <RemoveControl onRemove={onRemove} locked={locked} label={label} message={removeMessage} />
      </div>
      {spinner}
      {children}
    </div>
  )
}
