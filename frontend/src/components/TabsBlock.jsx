import { useState, useRef, useId } from 'react'
import { Paragraphs, RemoveControl, GrowTextarea, contextSummary } from './LessonBlocks'
import LoadingState from './LoadingState'

// A tabs block: 2 to 5 parallel ideas, one tab each, for layering or
// comparing content (like Rise 360 tabs).
//
//   TabsView     the learner's view. A real ARIA tabs widget:
//                  - role="tablist" holding role="tab" buttons
//                  - the selected tab has aria-selected="true", tabIndex 0
//                  - the others have tabIndex -1 (one Tab stop for the list)
//                  - ArrowLeft / ArrowRight move and select, wrapping at the
//                    ends; Home and End jump to the first and last tab
//                  - each tab controls a role="tabpanel" that it labels
//                  - the panel itself can be focused, so a keyboard user can
//                    Tab from the tab list into the content
//   TabsEditor   inline editing: title, labels, bodies, visual notes, and
//                add, remove, or reorder tabs (buttons, no drag and drop)
//   TabsBlock    the block: proposal, ready view, or editor, with actions

const MIN_TABS = 2
const MAX_TABS = 5
const SOFT_TAB_WORDS = 50
const wordsIn = t => (t.trim() ? t.trim().split(/\s+/).length : 0)

function TabsView({ block }) {
  const baseId = useId()
  const [selected, setSelected] = useState(0)
  const tabRefs = useRef([])
  const tabs = block.tabs
  const current = Math.min(selected, tabs.length - 1)

  function move(to) {
    setSelected(to)
    tabRefs.current[to]?.focus()
  }

  function onKeyDown(e, i) {
    const last = tabs.length - 1
    if (e.key === 'ArrowRight') { e.preventDefault(); move(i === last ? 0 : i + 1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); move(i === 0 ? last : i - 1) }
    else if (e.key === 'Home') { e.preventDefault(); move(0) }
    else if (e.key === 'End') { e.preventDefault(); move(last) }
  }

  return (
    <div className="lesson-tabs">
      <div role="tablist" aria-label={block.title || 'Tabs'} className="lesson-tabs-list">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={el => { tabRefs.current[i] = el }}
            id={`${baseId}-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={i === current}
            aria-controls={`${baseId}-panel-${t.id}`}
            tabIndex={i === current ? 0 : -1}
            className={`lesson-tab ${i === current ? 'selected' : ''}`}
            onClick={() => setSelected(i)}
            onKeyDown={e => onKeyDown(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div
          key={t.id}
          id={`${baseId}-panel-${t.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${t.id}`}
          hidden={i !== current}
          tabIndex={0}
          className="lesson-tabpanel"
        >
          <div className="lesson-body"><Paragraphs text={t.body} /></div>
          {t.visual && (
            <div className="lesson-visual">
              <div className="lesson-label">Visual</div>
              <p>{t.visual}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export function TabsEditor({ initial, onSave, onCancel, busy, saveLabel = 'Save' }) {
  const keyRef = useRef(0)
  const withKey = t => ({ ...t, _k: ++keyRef.current })
  const blank = () => withKey({ label: '', body: '', visual: '' })

  const [title, setTitle] = useState(initial?.title || '')
  const [tabs, setTabs] = useState(() =>
    (initial?.tabs?.length ? initial.tabs : [blank(), blank()]).map(t => withKey({ visual: '', ...t }))
  )

  const patch = (i, p) => setTabs(ts => ts.map((t, j) => (j === i ? { ...t, ...p } : t)))
  const remove = i => setTabs(ts => ts.filter((_, j) => j !== i))
  const add = () => setTabs(ts => [...ts, blank()])
  const swap = (i, k) => setTabs(ts => {
    const next = [...ts]
    ;[next[i], next[k]] = [next[k], next[i]]
    return next
  })

  function save(e) {
    e.preventDefault()
    onSave({
      title,
      tabs: tabs.map(t => ({ id: t.id, label: t.label, body: t.body, visual: t.visual })),
    })
  }

  return (
    <form className="tabs-editor" onSubmit={save} aria-label="Edit tabs">
      <div className="form-group">
        <label>
          Block heading <span className="label-optional">(optional)</span>
          <input type="text" value={title} maxLength={120} onChange={e => setTitle(e.target.value)} disabled={busy} />
        </label>
      </div>

      <p className="field-help">{MIN_TABS} to {MAX_TABS} tabs. Keep each tab to one idea.</p>

      {tabs.map((t, i) => (
        <div key={t._k} className="tabs-editor-tab">
          <div className="form-group">
            <label>
              Tab {i + 1} label
              <input type="text" value={t.label} maxLength={40} onChange={e => patch(i, { label: e.target.value })} disabled={busy} />
            </label>
          </div>
          <div className="form-group">
            <label>
              Tab {i + 1} text
              <textarea rows={3} value={t.body} onChange={e => patch(i, { body: e.target.value })} disabled={busy} />
            </label>
            {wordsIn(t.body) > SOFT_TAB_WORDS && (
              <p className="field-help" role="status">
                This tab is {wordsIn(t.body)} words. Tabs read best at {SOFT_TAB_WORDS} or fewer. You can still save it.
              </p>
            )}
          </div>
          <div className="form-group">
            <label>
              Tab {i + 1} visual note <span className="label-optional">(optional)</span>
              <GrowTextarea value={t.visual} onChange={e => patch(i, { visual: e.target.value })} disabled={busy} />
            </label>
          </div>
          <div className="lesson-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => swap(i, i - 1)} disabled={busy || i === 0} aria-label={`Move tab ${i + 1} up`}>
              Move up
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => swap(i, i + 1)} disabled={busy || i === tabs.length - 1} aria-label={`Move tab ${i + 1} down`}>
              Move down
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => remove(i)} disabled={busy || tabs.length <= MIN_TABS} aria-label={`Remove tab ${i + 1}`}>
              Remove tab
            </button>
          </div>
        </div>
      ))}

      <div className="lesson-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={add} disabled={busy || tabs.length >= MAX_TABS}>
          Add tab
        </button>
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
//   block                      the lesson block ({ kind:'tabs', state, tabs, ... })
//   busy / disabled            this block is working / some block is working
//   editing                    show the inline editor
//   onEdit / onSave / onCancelEdit
//   onGenerate                 open the context panel (parent renders it)
//   onRemove
//   children                   the context panel and/or an error, below the block
export function TabsBlock({ block, busy, disabled, editing, onEdit, onSave, onCancelEdit, onGenerate, onRemove, removeMessage, children }) {
  const locked = busy || disabled
  const spinner = busy && (
    <LoadingState subtle message="Working on your tabs..." hint="This may take up to 30 seconds." />
  )

  if (block.state === 'proposed') {
    return (
      <div className="lesson-block lesson-proposal">
        <div className="lesson-label">
          Suggested: Tabs block
          <span className="lesson-minutes">about {block.minutes} min</span>
        </div>
        <p className="lesson-proposal-note">{block.placement_note}</p>
        {editing ? (
          <TabsEditor initial={{ title: '', tabs: [] }} onSave={onSave} onCancel={onCancelEdit} busy={busy} saveLabel="Save tabs" />
        ) : (
          <div className="lesson-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={onGenerate} disabled={locked}>
              Generate tabs
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onEdit} disabled={locked}>
              Write it myself
            </button>
            <RemoveControl onRemove={onRemove} locked={locked} message={removeMessage || 'Remove this suggestion from the lesson?'} />
          </div>
        )}
        {spinner}
        {children}
      </div>
    )
  }

  return (
    <div className="lesson-block lesson-tabs-block">
      <div className="lesson-label">
        Tabs
        {block.edited && <span className="lesson-badge">Edited by you</span>}
        <span className="lesson-minutes">{block.minutes} min</span>
      </div>
      {block.title && <h3 className="lesson-chunk-title">{block.title}</h3>}

      {editing ? (
        <TabsEditor initial={block} onSave={onSave} onCancel={onCancelEdit} busy={busy} />
      ) : (
        <>
          <TabsView block={block} />
          {contextSummary(block.generation_context) && (
            <p className="lesson-proposal-note">Generated with: {contextSummary(block.generation_context)}</p>
          )}
          <div className="lesson-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onEdit} disabled={locked}>
              Edit
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onGenerate} disabled={locked}>
              Regenerate
            </button>
            <RemoveControl
              onRemove={onRemove}
              locked={locked}
              message={removeMessage || (block.edited
                ? 'Remove this tabs block? Your edits will be lost.'
                : 'Remove this tabs block from the lesson?')}
            />
          </div>
        </>
      )}
      {spinner}
      {children}
    </div>
  )
}

export default TabsBlock
