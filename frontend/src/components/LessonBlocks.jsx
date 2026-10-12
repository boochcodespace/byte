import { useState } from 'react'
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
export function Paragraphs({ text }) {
  return (text || '')
    .split(/\n{2,}/)
    .filter(p => p.trim())
    .map((p, i) => <p key={i}>{p.trim()}</p>)
}

const KIND_LABEL = { hook: 'Start here', chunk: null, apply: 'Apply today' }

export function TextBlock({ block }) {
  const [showAnswer, setShowAnswer] = useState(false)

  if (block.kind === 'recall') {
    return (
      <div className="lesson-block lesson-block-recall">
        <div className="lesson-label">
          Day {block.recall_day} recall
          <span className="lesson-minutes">not counted in lesson time</span>
        </div>
        <p className="lesson-recall-question">{block.body}</p>
        {showAnswer ? (
          <div className="lesson-recall-answer">
            <div className="lesson-label">Answer</div>
            <p>{block.answer}</p>
          </div>
        ) : (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAnswer(true)}>
            Show answer
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={`lesson-block lesson-block-${block.kind}`}>
      {KIND_LABEL[block.kind] && (
        <div className="lesson-label">
          {KIND_LABEL[block.kind]}
          <span className="lesson-minutes">{block.minutes} min</span>
        </div>
      )}
      {block.kind === 'chunk' && (
        <h3 className="lesson-chunk-title">
          {block.title}
          <span className="lesson-minutes">{block.minutes} min</span>
        </h3>
      )}
      <div className="lesson-body">
        <Paragraphs text={block.body} />
      </div>
      {block.kind === 'chunk' && block.visual && (
        <div className="lesson-visual">
          <div className="lesson-label">Visual</div>
          <p>{block.visual}</p>
        </div>
      )}
    </div>
  )
}

// Remove with a short confirmation. Removing takes the BLOCK out of the
// lesson only; the artifact itself stays in the project and is still
// offered by the picker.
export function RemoveControl({
  onRemove,
  locked,
  message = 'Remove this from the lesson? The artifact stays in your project.',
}) {
  const [confirming, setConfirming] = useState(false)
  if (!confirming) {
    return (
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirming(true)} disabled={locked}>
        Remove
      </button>
    )
  }
  return (
    <span className="delete-confirm">
      <span>{message}</span>
      <button type="button" className="btn btn-danger btn-sm" onClick={onRemove} disabled={locked}>
        Yes, remove
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirming(false)} disabled={locked}>
        Cancel
      </button>
    </span>
  )
}

// Replace offers two choices: pick another existing artifact, or generate
// a new one. The artifact being replaced stays in the project.
function ReplaceControl({ onPickExisting, onGenerate, locked }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)} disabled={locked}>
        Replace
      </button>
    )
  }
  return (
    <span className="delete-confirm">
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
          {meta.icon} {meta.label}
          <span className="lesson-minutes">{block.minutes} min</span>
        </div>
        {/* The renderer owns the learner's progress. It only resets if
            `artifact` changes identity or this key changes. */}
        <Renderer key={`${block.id}:${block.ref.source}/${block.ref.artifact}`} artifact={artifact} />
        {contextSummary(block.generation_context) && (
          <p className="lesson-proposal-note">Generated with: {contextSummary(block.generation_context)}</p>
        )}
        <div className="lesson-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onGenerate} disabled={locked}>
            Regenerate
          </button>
          <ReplaceControl onPickExisting={onPickExisting} onGenerate={onGenerate} locked={locked} />
          <RemoveControl onRemove={onRemove} locked={locked} />
        </div>
        {spinner}
        {children}
      </div>
    )
  }

  if (block.unavailable || (block.state === 'ready' && !artifact)) {
    return (
      <div className="lesson-block lesson-unavailable">
        <div className="lesson-label">{meta.icon} {meta.label}</div>
        <p>
          This artifact is no longer available. Your lesson is unchanged and nothing was deleted.
        </p>
        <div className="lesson-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={onPickExisting} disabled={locked}>
            Pick another
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onGenerate} disabled={locked}>
            Generate a new one
          </button>
          <RemoveControl onRemove={onRemove} locked={locked} />
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
        {meta.icon} Suggested: {meta.label}
        <span className="lesson-minutes">about {block.minutes} min</span>
      </div>
      <p className="lesson-proposal-note">{block.placement_note}</p>
      <div className="lesson-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={onGenerate} disabled={locked}>
          Generate for this lesson
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onPickExisting} disabled={locked}>
          Pick existing
        </button>
        <RemoveControl onRemove={onRemove} locked={locked} />
      </div>
      {spinner}
      {children}
    </div>
  )
}
