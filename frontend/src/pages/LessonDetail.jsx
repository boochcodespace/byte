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
import { TextBlock, ArtifactBlock } from '../components/LessonBlocks'
import { TabsBlock, TabsEditor } from '../components/TabsBlock'
import InsertControl from '../components/InsertControl'
import { ARTIFACT_TYPE_OPTIONS } from '../artifact-renderers/registry'
import './Lesson.css'

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

const STATUS_LABEL = {
  blueprint: 'Blueprint',
  approved: 'Blueprint approved',
  drafted: 'Drafted',
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

  const runBlock = useCallback(async (blockId, fn) => {
    retryBlockRef.current = () => runBlock(blockId, fn)
    setFailedBlock(null)
    setActiveBlock(blockId)
    const resp = await blockAction.run(fn)
    setActiveBlock(null)
    if (resp) {
      applyResponse(resp)
      setPickerFor(null)
      setContextFor(null)
      setEditFor(null)
      setInsertFlow(null)
    } else {
      setFailedBlock(blockId)
    }
  }, [blockAction, applyResponse])

  // Generate (or regenerate) with the context typed in the panel.
  const generateArtifact = (block, context) =>
    runBlock(block.id, () => api.post(`${base}/blocks/${block.id}/artifact`, { mode: 'new', context }))
  // Open the context panel / picker / editor for a block. Only one is open.
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
  const removeBlock = block =>
    runBlock(block.id, () => api.delete(`${base}/blocks/${block.id}`))

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
          busy={working}
          disabled={blockAction.loading}
          editing={editFor === block.id}
          onEdit={() => openEdit(block)}
          onSave={payload => saveTabs(block, payload)}
          onCancelEdit={() => setEditFor(null)}
          onGenerate={() => openContext(block)}
          onRemove={() => removeBlock(block)}
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
              onCancel={() => setContextFor(null)}
            />
          )}
          {failed}
        </TabsBlock>
      )
    }

    if (block.kind !== 'artifact') return <TextBlock block={block} />

    const artifact = block.ref ? artifacts[`${block.ref.source}/${block.ref.artifact}`] : null
    return (
      <ArtifactBlock
        block={block}
        artifact={artifact}
        busy={working}
        disabled={blockAction.loading}
        onGenerate={() => openContext(block)}
        onPickExisting={() => openPicker(block)}
        onRemove={() => removeBlock(block)}
      >
        {contextFor === block.id && (
          <ContextPanel
            type={block.artifact_type}
            initial={block.generation_context}
            limits={limits}
            lessonExperience={lesson.context?.experience}
            busy={working}
            submitLabel={block.state === 'ready' ? 'Regenerate' : 'Generate'}
            onSubmit={ctx => generateArtifact(block, ctx)}
            onCancel={() => setContextFor(null)}
          />
        )}
        {pickerFor === block.id && (
          <ArtifactPicker
            projectSlug={projectSlug}
            type={block.artifact_type}
            currentRef={block.ref}
            onPick={ref => pickArtifact(block, ref)}
            onCancel={() => setPickerFor(null)}
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
    const cancel = () => setInsertFlow(null)
    let ui = null

    if (option.kind === 'tabs' && mode.id === 'write') {
      ui = (
        <TabsEditor
          initial={{ title: '', tabs: [] }}
          busy={working}
          saveLabel="Insert tabs"
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
      <nav className="breadcrumb">
        <Link to="/">Projects</Link>
        <span className="breadcrumb-sep">›</span>
        <Link to={`/projects/${projectSlug}`}>{projectSlug}</Link>
        <span className="breadcrumb-sep">›</span>
        <span>{lesson.title}</span>
      </nav>

      <div className="lesson-header">
        <h1>{lesson.title}</h1>
        <span className={`lesson-status lesson-status-${lesson.status}`}>
          {noBlueprint ? 'Not planned yet' : STATUS_LABEL[lesson.status]}
        </span>
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
          <div className="lesson-blocks">
            {lesson.blocks.map(block => (
              <Fragment key={block.id}>
                {renderBlock(block)}
                {block.kind !== 'recall' && (
                  <>
                    <InsertControl
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
