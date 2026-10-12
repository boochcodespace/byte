import { Fragment, useState, useEffect, useCallback, useRef } from 'react'
import { useParams, Link, useLocation } from 'react-router-dom'
import { api } from '../lib/apiFetch'
import { stabilizeArtifacts } from '../lib/stabilize'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { actionPropsFor } from '../lib/errorActions'
import LoadingState from '../components/LoadingState'
import ErrorState from '../components/ErrorState'
import TimeMeter from '../components/TimeMeter'
import ArtifactPicker from '../components/ArtifactPicker'
import ContextPanel from '../components/ContextPanel'
import { TextBlock, TextEditor, ArtifactBlock } from '../components/LessonBlocks'
import { TabsBlock, TabsEditor } from '../components/TabsBlock'
import InsertControl from '../components/InsertControl'
import AccessibilityChecker from '../components/AccessibilityChecker'
import { ARTIFACT_TYPE_OPTIONS, EDITABLE_ARTIFACT_TYPES, getTypeMeta } from '../artifact-renderers/registry'
import ArtifactEditShell from '../components/ArtifactEditShell'
import './Lesson.css'
import { usePageTitle } from '../hooks/usePageTitle'

// LessonDetail: one lesson, from blueprint to finished document.
//
//   status "blueprint"  → edit the plan (objective, context, sections)
//   status "approved"   → plan is locked in; write the lesson
//   status "drafted"    → the lesson: text blocks, with artifact blocks
//                         you accept (generate or pick) or dismiss
//
// Every action returns the whole lesson plus its resolved artifacts, and
// this page swaps them in. Artifact objects are kept STABLE between
// responses (see lib/stabilize.js) so a learner's progress inside an
// embedded knowledge check or scenario survives edits elsewhere on the
// page and time-meter updates.

const EXPERIENCE = ['Novice', 'Practicing', 'Expert']

// What "Insert here" offers. Each option lists HOW it can be added. The
// InsertControl only reports the choice; this page runs the matching flow.
const INSERT_OPTIONS = [
  {
    id: 'tabs',
    label: 'Tabs block',
    kind: 'tabs',
    modes: [
      { id: 'write', label: 'Write it myself' },
      { id: 'generate', label: 'Generate...' },
    ],
  },
  ...[
    { id: 'chunk', label: 'Chunk' },
    { id: 'apply', label: 'Apply block' },
    { id: 'recall', label: 'Recall prompt' },
  ].map(t => ({
    ...t,
    kind: t.id,
    modes: [
      { id: 'write', label: 'Write it myself' },
      { id: 'generate', label: 'Generate...' },
    ],
  })),
  ...ARTIFACT_TYPE_OPTIONS.map(t => ({
    id: t.value,
    label: t.label,
    kind: 'artifact',
    artifact_type: t.value,
    modes: [
      { id: 'existing', label: 'Pick existing' },
      { id: 'new', label: 'Generate new...' },
    ],
  })),
]

const RECALL_DAYS = [2, 7, 21]
const TEXT_KINDS = ['chunk', 'apply', 'recall']

const STATUS_LABEL = {
  blueprint: 'Blueprint',
  approved: 'Blueprint approved',
  drafted: 'Drafted',
}

// A short name for a block, for button labels and announcements.
const ARTIFACT_NAME = Object.fromEntries(ARTIFACT_TYPE_OPTIONS.map(t => [t.value, t.label]))
function blockName(b) {
  if (b.kind === 'chunk') return `the chunk "${b.title}"`
  if (b.kind === 'apply') return 'the apply block'
  if (b.kind === 'hook') return 'the hook'
  if (b.kind === 'recall') return `the day ${b.recall_day} recall prompt`
  if (b.kind === 'tabs') return b.title ? `the tabs block "${b.title}"` : 'the tabs block'
  return `the ${(ARTIFACT_NAME[b.artifact_type] || 'artifact').toLowerCase()}`
}

// The accessible name of a block, so repeated buttons (Edit, Remove, ...)
// each say which block they act on, e.g. "Edit chunk: What does a host do?".
function blockLabel(b) {
  if (b.kind === 'chunk') return `chunk: ${b.title}`
  if (b.kind === 'hook') return 'hook'
  if (b.kind === 'apply') return 'apply block'
  if (b.kind === 'recall') return `day ${b.recall_day} recall prompt`
  if (b.kind === 'tabs') return b.title ? `tabs block: ${b.title}` : 'tabs block'
  return (ARTIFACT_NAME[b.artifact_type] || 'artifact').toLowerCase()
}

const kindLabel = s =>
  s.kind === 'recall' ? `Recall · day ${s.recall_day}` : s.kind[0].toUpperCase() + s.kind.slice(1)

function makeDraft(lesson) {
  return {
    title: lesson.title,
    objective: lesson.objective,
    time_budget_minutes: lesson.time_budget_minutes,
    context: {
      role: lesson.context?.role || '',
      experience: lesson.context?.experience || '',
      useCase: lesson.context?.useCase || '',
      learningObjectives: lesson.context?.learningObjectives || '',
    },
    sections: lesson.blueprint.sections.map(s => ({ ...s })),
  }
}

function LessonDetail() {
  const { projectSlug, lessonId } = useParams()
  const location = useLocation()
  const base = `/api/projects/${projectSlug}/lessons/${lessonId}`

  const [lesson, setLesson] = useState(null)
  usePageTitle(lesson?.title)
  const [artifacts, setArtifacts] = useState({})
  const [draft, setDraft] = useState(null)
  const [notice, setNotice] = useState(location.state?.notice || null)
  const [confirmRegen, setConfirmRegen] = useState(false)
  const [activeBlock, setActiveBlock] = useState(null)   // block being worked on
  const [failedBlock, setFailedBlock] = useState(null)   // block whose last action failed
  const [pickerFor, setPickerFor] = useState(null)       // block whose picker is open
  const [contextFor, setContextFor] = useState(null)     // block whose context panel is open
  const [editFor, setEditFor] = useState(null)           // tabs block whose editor is open
  const [insertFlow, setInsertFlow] = useState(null)      // { after, option, mode } while inserting
  const [recallDay, setRecallDay] = useState('')       // day chosen for an inserted recall prompt
  const [announce, setAnnounce] = useState('')           // screen-reader message after a move
  const pendingFocus = useRef(null)                      // data-focus-key to focus after the next render
  const openRef = useRef({})                             // which editor/panel/flow is open (for runBlock)
  const pendingMove = useRef(null)                       // { id, dir } to restore focus after a move
  const [limits, setLimits] = useState(null)             // in-lesson size limits from the API

  const loadAction = useAsyncAction()
  const blueprintAction = useAsyncAction()
  const saveAction = useAsyncAction()
  const textAction = useAsyncAction()
  const blockAction = useAsyncAction()
  const retryBlockRef = useRef(null)

  const applyResponse = useCallback((resp) => {
    setLesson(resp.lesson)
    setArtifacts(prev => stabilizeArtifacts(prev, resp.artifacts))
    if (resp.limits) setLimits(resp.limits)
  }, [])

  const loadLesson = useCallback(async () => {
    const resp = await loadAction.run(() => api.get(base))
    if (resp) applyResponse(resp)
  }, [loadAction, base, applyResponse])

  useEffect(() => {
    loadLesson()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base])

  // The draft is the editable copy of the blueprint. It is rebuilt only
  // when the server's blueprint changes (load, save, regenerate).
  useEffect(() => {
    if (lesson && lesson.blueprint && lesson.status !== 'drafted') setDraft(makeDraft(lesson))
  }, [lesson])

  // ── blueprint actions ──────────────────────────────────────────────

  const generateBlueprint = useCallback(async () => {
    const resp = await blueprintAction.run(() => api.post(`${base}/blueprint/generate`))
    if (resp) {
      applyResponse(resp)
      setNotice(null)
      setConfirmRegen(false)
    }
  }, [blueprintAction, base, applyResponse])

  const saveBlueprint = useCallback(async (approve) => {
    if (!draft) return
    const body = {
      title: draft.title,
      objective: draft.objective,
      time_budget_minutes: Number(draft.time_budget_minutes),
      context: draft.context,
      sections: draft.sections.map(s => ({
        id: s.id,
        title: s.title,
        purpose: s.purpose,
        target_minutes: Number(s.target_minutes),
      })),
      ...(approve ? { approve: true } : {}),
    }
    const resp = await saveAction.run(() => api.put(`${base}/blueprint`, body))
    if (resp) applyResponse(resp)
  }, [draft, saveAction, base, applyResponse])

  // Unlock an approved blueprint for editing (an edit with no changes
  // returns it to "blueprint").
  const unlockBlueprint = useCallback(async () => {
    const resp = await saveAction.run(() => api.put(`${base}/blueprint`, {}))
    if (resp) applyResponse(resp)
  }, [saveAction, base, applyResponse])

  const writeLesson = useCallback(async () => {
    const resp = await textAction.run(() => api.post(`${base}/text/generate`))
    if (resp) applyResponse(resp)
  }, [textAction, base, applyResponse])

  // ── block actions (accept / pick / dismiss) ────────────────────────

  openRef.current = { editFor, contextFor, pickerFor, insertFlow }

  const runBlock = useCallback(async (blockId, fn) => {
    retryBlockRef.current = () => runBlock(blockId, fn)
    setFailedBlock(null)
    setActiveBlock(blockId)
    const resp = await blockAction.run(fn)
    setActiveBlock(null)
    if (!resp) pendingMove.current = null
    if (resp) {
      // Put keyboard focus back where the user was working.
      const o = openRef.current
      if (o.editFor === blockId) pendingFocus.current = `edit:${blockId}`
      else if (o.contextFor === blockId || o.pickerFor === blockId) pendingFocus.current = `regen:${blockId}`
      else if (o.insertFlow) pendingFocus.current = `insert:${o.insertFlow.after}`
      applyResponse(resp)
      setPickerFor(null)
      setContextFor(null)
      setEditFor(null)
      setInsertFlow(null)
    } else {
      setFailedBlock(blockId)
    }
    return resp
  }, [blockAction, applyResponse])

  // Generate (or regenerate) with the context typed in the panel.
  const generateArtifact = (block, context) =>
    runBlock(block.id, () => api.post(`${base}/blocks/${block.id}/artifact`, { mode: 'new', context }))
  // Open the context panel / picker / editor for a block. Only one is open.
  const closeEdit = id => { setEditFor(null); pendingFocus.current = `edit:${id}` }
  const closeContext = id => { setContextFor(null); pendingFocus.current = `regen:${id}` }
  const closePicker = id => { setPickerFor(null); pendingFocus.current = `regen:${id}` }
  // The checker's Fix button: go to the block and open what fixes the issue.
  const [, setFixTick] = useState(0)
  const fixIssue = issue => {
    const block = issue.blockId ? lesson.blocks.find(b => b.id === issue.blockId) : null
    if (!block) { pendingFocus.current = 'page-title'; setFixTick(t => t + 1); return }
    closeAll()
    const editable = (block.kind === 'chunk' || (block.kind === 'tabs' && block.state === 'ready')) && issue.fix === 'edit'
    if (editable) { setEditFor(block.id); return }
    pendingFocus.current = `regen:${block.id}`
    setFixTick(t => t + 1)
  }

  const closeAll = () => { setPickerFor(null); setContextFor(null); setEditFor(null); setInsertFlow(null) }
  const openContext = block => { closeAll(); setContextFor(block.id) }
  const openPicker = block => { closeAll(); setPickerFor(block.id) }
  const openEdit = block => { closeAll(); setEditFor(block.id) }

  // Tabs: generate or regenerate (confirmed overwrite when hand-edited),
  // and save inline edits.
  const generateTabs = (block, context) =>
    runBlock(block.id, () =>
      api.post(`${base}/blocks/${block.id}/tabs/generate`, { context, ...(block.edited ? { overwrite: true } : {}) }))
  const saveTabs = (block, payload) =>
    runBlock(block.id, () => api.put(`${base}/blocks/${block.id}/tabs`, payload))

  // Insert here: choose a kind and mode, then run that flow under the control.
  const insertKey = afterId => `insert:${afterId}`
  const startInsert = (afterBlock, { option, mode }) => {
    closeAll()
    setInsertFlow({ after: afterBlock.id, option, mode })
  }
  const submitInsert = (afterId, body) =>
    runBlock(insertKey(afterId), () => api.post(`${base}/blocks`, { after: afterId, ...body }))
  const pickArtifact = (block, ref) =>
    runBlock(block.id, () =>
      api.post(`${base}/blocks/${block.id}/artifact`, { mode: 'existing', source: ref.source, artifact: ref.folder }))
  const moveBlock = (block, dir) => {
    pendingMove.current = { id: block.id, dir }
    runBlock(block.id, () => api.post(`${base}/blocks/${block.id}/move`, { direction: dir }))
  }
  const draftAlt = brief => api.post(`${base}/alt-text/draft`, { visual: brief })
  const generateText = (block, context) =>
    runBlock(block.id, () =>
      api.post(`${base}/blocks/${block.id}/text/generate`, { context, ...(block.edited ? { overwrite: true } : {}) }))
  const saveText = (block, payload) =>
    runBlock(block.id, () => api.put(`${base}/blocks/${block.id}/text`, payload))
  // Artifact editing. An artifact is shared by every lesson that uses it, so
  // the edit shell asks first when another lesson uses it. After a save the
  // lesson is reloaded (new minutes, new words); only the edited artifact gets a
  // new identity, so progress in every other block survives.
  const reloadLesson = async () => {
    const resp = await api.get(base)
    if (resp) applyResponse(resp)
  }
  const artifactSaved = async (block, resp) => {
    await reloadLesson()
    closeEdit(block.id)
    const label = getTypeMeta(block.artifact_type).label.toLowerCase()
    setAnnounce(resp.changed ? `Saved your changes to the ${label}.` : `No changes to save in the ${label}.`)
  }
  const copyForLesson = async block => {
    const resp = await api.post(`${base}/blocks/${block.id}/artifact/copy`, {})
    if (resp) {
      applyResponse(resp)
      setAnnounce('Made a copy for this lesson. Now editing the copy.')
    }
  }

  const removeBlock = async block => {
    const name = blockLabel(block)
    const resp = await runBlock(block.id, () => api.delete(`${base}/blocks/${block.id}`))
    if (resp) {
      setAnnounce(`Removed ${name}.`)
      pendingFocus.current = 'page-title'
    }
  }

  // After a move, put keyboard focus back on the button that was used (or
  // the other one if it just reached its limit) and tell screen readers.
  useEffect(() => {
    const m = pendingMove.current
    if (!m || !lesson) return
    pendingMove.current = null
    const i = lesson.blocks.findIndex(b => b.id === m.id)
    if (i === -1) return
    const el = document.querySelector(`[data-move="${m.id}:${m.dir}"]`)
    const other = document.querySelector(`[data-move="${m.id}:${m.dir === 'up' ? 'down' : 'up'}"]`)
    const target = el && !el.disabled ? el : other
    if (target) target.focus()
    setAnnounce(`Moved ${blockName(lesson.blocks[i])} ${m.dir}. It is now block ${i + 1} of ${lesson.blocks.length}.`)
  }, [lesson])

  // Restore focus after an editor, panel, or flow closes (WCAG 2.4.3).
  useEffect(() => {
    const key = pendingFocus.current
    if (!key) return
    pendingFocus.current = null
    const el = document.querySelector(`[data-focus-key="${key}"]`)
    if (el && !el.disabled) el.focus()
  })

  // ── draft editing helpers ──────────────────────────────────────────

  const patchDraft = patch => setDraft(d => ({ ...d, ...patch }))
  const patchContext = patch => setDraft(d => ({ ...d, context: { ...d.context, ...patch } }))
  const patchSection = (id, patch) =>
    setDraft(d => ({ ...d, sections: d.sections.map(s => (s.id === id ? { ...s, ...patch } : s)) }))
  const removeSection = id =>
    setDraft(d => ({ ...d, sections: d.sections.filter(s => s.id !== id) }))

  // ── page-level states ──────────────────────────────────────────────

  if (loadAction.loading && !lesson) return <LoadingState message="Loading lesson..." />
  if (loadAction.error && !lesson) {
    return (
      <ErrorState
        message={loadAction.error.userMessage}
        onRetry={loadLesson}
        {...actionPropsFor(loadAction.error.errorType)}
      />
    )
  }
  if (!lesson) return null

  const noBlueprint = !lesson.blueprint

  // Confirmation text for Remove. When taking this block out would leave no
  // ready knowledge check or scenario, say so (the user can still go on).
  function removeMessageFor(block, plain) {
    const isRetrieval = b =>
      b.kind === 'artifact' && b.state === 'ready' && !b.unavailable &&
      (b.artifact_type === 'knowledge-check' || b.artifact_type === 'scenario-branching')
    // Warn only when THIS removal causes the loss: one existed, none will.
    const causesLoss = isRetrieval(block) && !lesson.blocks.some(b => b.id !== block.id && isRetrieval(b))
    return !causesLoss ? plain : `${plain} This lesson will then have no knowledge check or scenario, so learners get no retrieval practice.`
  }

  // One lesson block: text, tabs, or an artifact slot.
  function renderBlock(block) {
    const working = activeBlock === block.id && blockAction.loading
    const failed = failedBlock === block.id && blockAction.error && (
      <ErrorState
        message={blockAction.error.userMessage}
        onRetry={() => retryBlockRef.current && retryBlockRef.current()}
        {...actionPropsFor(blockAction.error.errorType)}
      />
    )

    if (block.kind === 'tabs') {
      return (
        <TabsBlock
          block={block}
          label={blockLabel(block)}
          busy={working}
          disabled={blockAction.loading}
          editing={editFor === block.id}
          onEdit={() => openEdit(block)}
          onSave={payload => saveTabs(block, payload)}
          onCancelEdit={() => closeEdit(block.id)}
          onGenerate={() => openContext(block)}
          onDraftAlt={draftAlt}
          onRemove={() => removeBlock(block)}
          removeMessage={removeMessageFor(block, block.state === 'proposed'
            ? 'Remove this suggestion from the lesson?'
            : block.edited ? 'Remove this tabs block? Your edits will be lost.' : 'Remove this tabs block from the lesson?')}
        >
          {contextFor === block.id && (
            <ContextPanel
              type="tabs"
              initial={block.generation_context}
              limits={limits}
              lessonExperience={lesson.context?.experience}
              busy={working}
              submitLabel={block.state === 'ready' ? 'Regenerate' : 'Generate'}
              overwriteWarning={block.state === 'ready' && block.edited
                ? 'Regenerating replaces the edits you made to this tabs block, and they cannot be recovered.'
                : undefined}
              onSubmit={ctx => generateTabs(block, ctx)}
              onCancel={() => closeContext(block.id)}
            />
          )}
          {failed}
        </TabsBlock>
      )
    }

    if (block.kind !== 'artifact') {
      const lastHook = block.kind === 'hook' && lesson.blocks.filter(b => b.kind === 'hook').length <= 1
      return (
        <TextBlock
          block={block}
          label={blockLabel(block)}
          busy={working}
          disabled={blockAction.loading}
          editing={editFor === block.id}
          canRemove={!lastHook}
          onEdit={() => openEdit(block)}
          onSave={payload => saveText(block, payload)}
          onCancelEdit={() => closeEdit(block.id)}
          onGenerate={() => openContext(block)}
          onDraftAlt={draftAlt}
          onRemove={() => removeBlock(block)}
          removeMessage={removeMessageFor(block, block.edited
            ? 'Remove this block? Your edits will be lost.'
            : 'Remove this block from the lesson?')}
        >
          {contextFor === block.id && (
            <ContextPanel
              type="text"
              initial={block.generation_context}
              limits={limits}
              lessonExperience={lesson.context?.experience}
              busy={working}
              submitLabel="Regenerate"
              overwriteWarning={block.edited
                ? 'Regenerating replaces the edits you made to this block, and they cannot be recovered.'
                : undefined}
              onSubmit={ctx => generateText(block, ctx)}
              onCancel={() => closeContext(block.id)}
            />
          )}
          {failed}
        </TextBlock>
      )
    }

    const artifact = block.ref ? artifacts[`${block.ref.source}/${block.ref.artifact}`] : null
    return (
      <ArtifactBlock
        block={block}
        label={blockLabel(block)}
        artifact={artifact}
        busy={working}
        disabled={blockAction.loading}
        onGenerate={() => openContext(block)}
        onPickExisting={() => openPicker(block)}
        onRemove={() => removeBlock(block)}
        removeMessage={removeMessageFor(block, 'Remove this from the lesson? The artifact stays in your project.')}
        canEdit={EDITABLE_ARTIFACT_TYPES.has(block.artifact_type)}
        editing={editFor === block.id}
        onEdit={() => openEdit(block)}
        editor={block.ref && (
          <ArtifactEditShell
            key={`${block.id}:${block.ref.source}/${block.ref.artifact}`}
            projectSlug={projectSlug}
            source={block.ref.source}
            folder={block.ref.artifact}
            lessonId={lessonId}
            onSaved={resp => artifactSaved(block, resp)}
            onCancel={() => closeEdit(block.id)}
            onCopy={() => copyForLesson(block)}
          />
        )}
      >
        {contextFor === block.id && (
          <ContextPanel
            type={block.artifact_type}
            initial={block.generation_context}
            limits={limits}
            lessonExperience={lesson.context?.experience}
            busy={working}
            submitLabel={block.state === 'ready' ? 'Regenerate' : 'Generate'}
            overwriteWarning={artifact && artifact.edited
              ? `Byte will make a new ${getTypeMeta(block.artifact_type).label.toLowerCase()} for this lesson. Your edited version stays in the project and in any other lesson that uses it.`
              : undefined}
            confirmLabel="Make a new one"
            onSubmit={ctx => generateArtifact(block, ctx)}
            onCancel={() => closeContext(block.id)}
          />
        )}
        {pickerFor === block.id && (
          <ArtifactPicker
            projectSlug={projectSlug}
            type={block.artifact_type}
            currentRef={block.ref}
            onPick={ref => pickArtifact(block, ref)}
            onCancel={() => closePicker(block.id)}
          />
        )}
        {failed}
      </ArtifactBlock>
    )
  }

  // The flow opened by "Insert here" under a block.
  function renderInsertFlow(afterBlock) {
    const key = insertKey(afterBlock.id)
    const working = activeBlock === key && blockAction.loading
    const { option, mode } = insertFlow
    const cancel = () => { setInsertFlow(null); pendingFocus.current = `insert:${afterBlock.id}` }
    let ui = null

    if (TEXT_KINDS.includes(option.kind)) {
      const used = lesson.blocks.filter(b => b.kind === 'recall').map(b => b.recall_day)
      const free = RECALL_DAYS.filter(d => !used.includes(d))
      const day = recallDay && free.includes(Number(recallDay)) ? Number(recallDay) : free[0]
      const blank = { kind: option.kind, title: '', body: '', visual: '', answer: '' }
      const noDay = option.kind === 'recall' && free.length === 0
      const extra = option.kind === 'recall' ? { recall_day: day } : {}
      ui = (
        <>
          {option.kind === 'recall' && (
            <div className="form-group">
              <p className="field-help">Recall prompts always go at the end, in day order.</p>
              {noDay ? (
                <p className="field-help">All three recall days (2, 7, 21) are already in the lesson. Remove one first.</p>
              ) : (
                <label>
                  Recall day
                  <select value={day} onChange={e => setRecallDay(e.target.value)} disabled={working}>
                    {free.map(d => <option key={d} value={d}>Day {d}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
          {!noDay && (mode.id === 'write' ? (
            <TextEditor
              block={blank}
              busy={working}
              saveLabel="Insert"
              onDraftAlt={draftAlt}
              onSave={payload => submitInsert(afterBlock.id, { kind: option.kind, mode: 'write', ...extra, ...payload })}
              onCancel={cancel}
            />
          ) : (
            <ContextPanel
              type="text"
              limits={limits}
              lessonExperience={lesson.context?.experience}
              busy={working}
              onSubmit={ctx => submitInsert(afterBlock.id, { kind: option.kind, mode: 'generate', ...extra, context: ctx })}
              onCancel={cancel}
            />
          ))}
          {noDay && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={cancel}>Close</button>
          )}
        </>
      )
    } else if (option.kind === 'tabs' && mode.id === 'write') {
      ui = (
        <TabsEditor
          initial={{ title: '', tabs: [] }}
          busy={working}
          saveLabel="Insert tabs"
          onDraftAlt={draftAlt}
          onSave={payload => submitInsert(afterBlock.id, { kind: 'tabs', mode: 'write', ...payload })}
          onCancel={cancel}
        />
      )
    } else if (option.kind === 'tabs') {
      ui = (
        <ContextPanel
          type="tabs"
          limits={limits}
          lessonExperience={lesson.context?.experience}
          busy={working}
          onSubmit={ctx => submitInsert(afterBlock.id, { kind: 'tabs', mode: 'generate', context: ctx })}
          onCancel={cancel}
        />
      )
    } else if (mode.id === 'existing') {
      ui = (
        <ArtifactPicker
          projectSlug={projectSlug}
          type={option.artifact_type}
          onPick={ref => submitInsert(afterBlock.id, {
            kind: 'artifact', artifact_type: option.artifact_type, mode: 'existing',
            source: ref.source, artifact: ref.folder,
          })}
          onCancel={cancel}
        />
      )
    } else {
      ui = (
        <ContextPanel
          type={option.artifact_type}
          limits={limits}
          lessonExperience={lesson.context?.experience}
          busy={working}
          onSubmit={ctx => submitInsert(afterBlock.id, {
            kind: 'artifact', artifact_type: option.artifact_type, mode: 'new', context: ctx,
          })}
          onCancel={cancel}
        />
      )
    }

    return (
      <div className="insert-flow">
        {ui}
        {working && (
          <LoadingState subtle message="Adding to your lesson..." hint="This may take up to 30 seconds." />
        )}
        {failedBlock === key && blockAction.error && (
          <ErrorState
            message={blockAction.error.userMessage}
            onRetry={() => retryBlockRef.current && retryBlockRef.current()}
            {...actionPropsFor(blockAction.error.errorType)}
          />
        )}
      </div>
    )
  }

  return (
    <div className="lesson-page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Projects</Link>
        <span className="breadcrumb-sep" aria-hidden="true">›</span>
        <Link to={`/projects/${projectSlug}`}>{projectSlug}</Link>
        <span className="breadcrumb-sep" aria-hidden="true">›</span>
        <span>{lesson.title}</span>
      </nav>

      <div className="lesson-header">
        <h1 tabIndex={-1} data-focus-key="page-title">{lesson.title}</h1>
        <span className={`lesson-status lesson-status-${lesson.status}`}>
          {noBlueprint ? 'Not planned yet' : STATUS_LABEL[lesson.status]}
        </span>
        {lesson.status === 'drafted' && (
          <Link to={`/projects/${projectSlug}/lessons/${lessonId}/preview`} className="btn btn-secondary btn-sm">
            Preview as learner
          </Link>
        )}
      </div>
      {lesson.objective && (
        <p className="lesson-objective"><strong>Objective:</strong> {lesson.objective}</p>
      )}

      {/* ── 1. no blueprint yet ───────────────────────────────────── */}
      {noBlueprint && (
        <div className="card lesson-card">
          <h2>Plan the lesson</h2>
          <p>
            Byte will read your sources and plan one objective, a hook, a few short chunks,
            an apply task, and recall prompts for day 2, 7, and 21. You can edit the plan
            before anything is written.
          </p>
          <p className="lesson-topic"><strong>Topic:</strong> {lesson.topic}</p>
          {notice && (
            <ErrorState
              message={notice.userMessage || 'The blueprint could not be created.'}
              onRetry={generateBlueprint}
              {...actionPropsFor(notice.errorType)}
            />
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={generateBlueprint}
            disabled={blueprintAction.loading}
          >
            {blueprintAction.loading ? 'Planning...' : 'Generate blueprint'}
          </button>
          {blueprintAction.loading && (
            <LoadingState subtle message="Planning your lesson..." hint="This may take up to 30 seconds." />
          )}
          {blueprintAction.error && (
            <ErrorState
              message={blueprintAction.error.userMessage}
              onRetry={generateBlueprint}
              {...actionPropsFor(blueprintAction.error.errorType)}
            />
          )}
        </div>
      )}

      {/* ── 2. blueprint editor ───────────────────────────────────── */}
      {!noBlueprint && lesson.status === 'blueprint' && draft && (
        <div className="card lesson-card bp-editor">
          <h2>Edit the blueprint</h2>
          <p className="sidebar-help">
            Change the objective, learner context, and each section. You can remove sections but
            not add them. Approve when it looks right and Byte will write the lesson.
          </p>

          <div className="form-group">
            <label htmlFor="bpTitle">Lesson title</label>
            <input id="bpTitle" type="text" value={draft.title} onChange={e => patchDraft({ title: e.target.value })} />
          </div>
          <div className="form-group">
            <label htmlFor="bpObjective">Objective</label>
            <textarea id="bpObjective" rows={2} value={draft.objective} onChange={e => patchDraft({ objective: e.target.value })} />
          </div>

          <div className="bp-context">
            <div className="form-group">
              <label htmlFor="bpRole">Role</label>
              <input id="bpRole" type="text" value={draft.context.role} onChange={e => patchContext({ role: e.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="bpExperience">Experience level</label>
              <select id="bpExperience" value={draft.context.experience} onChange={e => patchContext({ experience: e.target.value })}>
                <option value="">Select level...</option>
                {EXPERIENCE.map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="bpUseCase">Use case</label>
              <input id="bpUseCase" type="text" value={draft.context.useCase} onChange={e => patchContext({ useCase: e.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="bpBudget">Time budget</label>
              <select id="bpBudget" value={draft.time_budget_minutes} onChange={e => patchDraft({ time_budget_minutes: e.target.value })}>
                {[5, 6, 7, 8, 9, 10].map(m => <option key={m} value={m}>{m} minutes</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="bpLearningObjectives">
              Source learning objectives <span className="label-optional">(optional)</span>
            </label>
            <textarea
              id="bpLearningObjectives"
              rows={2}
              value={draft.context.learningObjectives}
              onChange={e => patchContext({ learningObjectives: e.target.value })}
            />
          </div>

          <h3 className="bp-heading">Sections</h3>
          <ol className="bp-sections">
            {draft.sections.map(s => (
              <li key={s.id} className="bp-section">
                <div className="bp-section-top">
                  <span className="bp-kind">{kindLabel(s)}</span>
                  <input
                    className="bp-title"
                    type="text"
                    aria-label={`Title of ${kindLabel(s)} section`}
                    value={s.title}
                    onChange={e => patchSection(s.id, { title: e.target.value })}
                  />
                  <label className="bp-minutes-wrap">
                    <input
                      className="bp-minutes"
                      type="number"
                      min="0"
                      max="10"
                      step="0.1"
                      aria-label={`Minutes for ${s.title}`}
                      value={s.target_minutes}
                      onChange={e => patchSection(s.id, { target_minutes: e.target.value })}
                    />
                    <span>min</span>
                  </label>
                  <button type="button" className="btn btn-secondary btn-sm bp-remove" onClick={() => removeSection(s.id)}>
                    Remove
                  </button>
                </div>
                <textarea
                  className="bp-purpose"
                  rows={2}
                  aria-label={`Purpose of ${s.title}`}
                  value={s.purpose}
                  onChange={e => patchSection(s.id, { purpose: e.target.value })}
                />
              </li>
            ))}
          </ol>

          {(() => {
            const textPlan = draft.sections
              .filter(s => s.kind !== 'recall')
              .reduce((sum, s) => sum + (Number(s.target_minutes) || 0), 0)
            const left = Math.round((Number(draft.time_budget_minutes) - textPlan) * 10) / 10
            return (
              <p className={`bp-summary ${left < 2.5 ? 'bp-summary-tight' : ''}`}>
                Text plan: <strong>{Math.round(textPlan * 10) / 10} min</strong> · Left for artifacts:{' '}
                <strong>{left} min</strong>
                {' '}(a flip deck, knowledge check, or scenario takes about 2.7 to 2.9 min each).
                Recall prompts are not counted.
              </p>
            )
          })()}

          {saveAction.error && (
            <ErrorState
              message={saveAction.error.userMessage}
              onRetry={() => saveBlueprint(false)}
              {...actionPropsFor(saveAction.error.errorType)}
            />
          )}

          <div className="lesson-actions">
            <button type="button" className="btn btn-primary" onClick={() => saveBlueprint(true)} disabled={saveAction.loading}>
              {saveAction.loading ? 'Saving...' : 'Approve blueprint'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => saveBlueprint(false)} disabled={saveAction.loading}>
              Save changes
            </button>
            {!confirmRegen ? (
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmRegen(true)} disabled={saveAction.loading}>
                Regenerate blueprint
              </button>
            ) : (
              <span className="delete-confirm">
                <span>This replaces your edits.</span>
                <button type="button" className="btn btn-danger btn-sm" onClick={generateBlueprint} disabled={blueprintAction.loading}>
                  {blueprintAction.loading ? 'Planning...' : 'Yes, regenerate'}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmRegen(false)}>
                  Cancel
                </button>
              </span>
            )}
          </div>
          {blueprintAction.error && (
            <ErrorState
              message={blueprintAction.error.userMessage}
              onRetry={generateBlueprint}
              {...actionPropsFor(blueprintAction.error.errorType)}
            />
          )}
        </div>
      )}

      {/* ── 3. approved ───────────────────────────────────────────── */}
      {!noBlueprint && lesson.status === 'approved' && (
        <div className="card lesson-card">
          <h2>Blueprint approved</h2>
          <ol className="bp-readonly">
            {lesson.blueprint.sections.map(s => (
              <li key={s.id}>
                <span className="bp-kind">{kindLabel(s)}</span> {s.title}
                <span className="lesson-minutes">{s.target_minutes} min</span>
              </li>
            ))}
          </ol>
          <div className="lesson-actions">
            <button type="button" className="btn btn-primary" onClick={writeLesson} disabled={textAction.loading}>
              {textAction.loading ? 'Writing...' : 'Write the lesson'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={unlockBlueprint} disabled={textAction.loading || saveAction.loading}>
              Edit blueprint
            </button>
          </div>
          {textAction.loading && (
            <LoadingState subtle message="Writing your lesson..." hint="This may take up to 60 seconds." />
          )}
          {textAction.error && (
            <ErrorState
              message={textAction.error.userMessage}
              onRetry={writeLesson}
              {...actionPropsFor(textAction.error.errorType)}
            />
          )}
          {saveAction.error && <ErrorState message={saveAction.error.userMessage} onRetry={unlockBlueprint} />}
        </div>
      )}

      {/* ── 4. the lesson ─────────────────────────────────────────── */}
      {lesson.status === 'drafted' && (
        <>
          <TimeMeter lesson={lesson} />
          <AccessibilityChecker base={base} stamp={lesson.updated_at} onFix={fixIssue} disabled={blockAction.loading} />
          <div className="sr-only" role="status" aria-live="polite">{announce}</div>
          <div className="lesson-blocks">
            {lesson.blocks.map(block => (
              <Fragment key={block.id}>
                {renderBlock(block)}
                {block.kind !== 'recall' && (
                  <>
                    {(block.can_move_up || block.can_move_down) && (
                      <div className="move-controls" role="group" aria-label={`Move ${blockName(block)}`}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          data-move={`${block.id}:up`}
                          aria-label={`Move ${blockName(block)} up`}
                          onClick={() => moveBlock(block, 'up')}
                          disabled={!block.can_move_up || blockAction.loading}
                        >
                          Move up
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          data-move={`${block.id}:down`}
                          aria-label={`Move ${blockName(block)} down`}
                          onClick={() => moveBlock(block, 'down')}
                          disabled={!block.can_move_down || blockAction.loading}
                        >
                          Move down
                        </button>
                      </div>
                    )}
                    <InsertControl
                      label={blockLabel(block)}
                      focusKey={`insert:${block.id}`}
                      options={INSERT_OPTIONS}
                      disabled={blockAction.loading}
                      onSelect={choice => startInsert(block, choice)}
                    />
                    {insertFlow && insertFlow.after === block.id && renderInsertFlow(block)}
                  </>
                )}
              </Fragment>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default LessonDetail
