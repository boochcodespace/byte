import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../lib/apiFetch'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { actionPropsFor } from '../lib/errorActions'
import { getTypeMeta } from '../artifact-renderers/registry'
import LoadingState from './LoadingState'
import ErrorState from './ErrorState'
import KnowledgeCheckEditor from './KnowledgeCheckEditor'

// Everything around an artifact editor: loading the artifact, the warning when
// other lessons use it, saving, and errors. The editor itself (one per type)
// only collects the words.
//
// An artifact is SHARED by every lesson that points at it, so an edit changes
// all of them. Before editing, if the artifact is used by another lesson, the
// author chooses:
//   Edit everywhere                  edit this artifact; every lesson shows it
//   Make a copy for this lesson      a copy in the same source folder, used by
//                                    this lesson only (it keeps `edited`)
//
// Props:
//   projectSlug, source, folder    which artifact
//   lessonId                       set when editing from a lesson block
//   onSaved(resp)                  called after a successful save
//   onCancel()                     close without saving
//   onCopy()                       make a copy (the page does the work and
//                                  re-mounts this shell on the copy); may be async

const EDITORS = { 'knowledge-check': KnowledgeCheckEditor }

function ArtifactEditShell({ projectSlug, source, folder, lessonId, onSaved, onCancel, onCopy }) {
  const url = `/api/projects/${projectSlug}/artifacts/${source}/${folder}`
  const loadAction = useAsyncAction()
  const saveAction = useAsyncAction()
  const [data, setData] = useState(null)
  const [everywhere, setEverywhere] = useState(false)
  const [copying, setCopying] = useState(false)
  const gateRef = useRef(null)

  const load = useCallback(async () => {
    const resp = await loadAction.run(() => api.get(url))
    if (resp) setData(resp)
  }, [loadAction, url])
  useEffect(() => { load() }, [url]) // eslint-disable-line react-hooks/exhaustive-deps

  const usage = data?.usage || []
  const others = lessonId ? usage.filter(u => u.lesson_id !== lessonId) : usage
  const gated = !!data && (lessonId ? others.length >= 1 : usage.length >= 2) && !everywhere
  const info = !!data && !lessonId && usage.length === 1
  const label = data ? getTypeMeta(data.type).label.toLowerCase() : 'artifact'
  const lessonNames = (lessonId ? others : usage).map(u => `"${u.title}"`)

  useEffect(() => { if (gated) gateRef.current?.focus() }, [gated])

  async function save(edits) {
    const resp = await saveAction.run(() => api.put(url, edits))
    if (resp) onSaved(resp)
  }

  async function copy() {
    setCopying(true)
    try { await onCopy() } finally { setCopying(false) }
  }

  if (loadAction.loading && !data) return <LoadingState subtle message={`Loading the ${label}...`} />
  if (loadAction.error && !data) {
    return (
      <ErrorState message={loadAction.error.userMessage} onRetry={load} {...actionPropsFor(loadAction.error.errorType)} />
    )
  }
  if (!data) return null

  if (gated) {
    return (
      <div className="artifact-edit-gate" role="group" aria-label={`This ${label} is used in other lessons`}>
        <p tabIndex={-1} ref={gateRef}>
          <strong>This {label} is used in {lessonId ? 'other lessons too' : `${usage.length} lessons`}: {lessonNames.join(', ')}.</strong>{' '}
          An edit changes it in all of them. You can edit it everywhere, or make a copy that only this {lessonId ? 'lesson' : 'copy'} uses.
        </p>
        <div className="lesson-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEverywhere(true)} disabled={copying}>
            Edit everywhere
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={copy} disabled={copying}>
            {copying ? 'Making a copy...' : lessonId ? 'Make a copy for this lesson' : 'Make a copy'}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel} disabled={copying}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  const Editor = EDITORS[data.type]
  if (!data.editable || !Editor) {
    return (
      <div>
        <p>Editing this kind of artifact is not available yet.</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    )
  }

  return (
    <div className="artifact-editor-wrap">
      {(everywhere || info) && usage.length > 0 && (
        <p className="lesson-proposal-note">
          Your edits show in every lesson that uses this {label}: {usage.map(u => `"${u.title}"`).join(', ')}.
        </p>
      )}
      <Editor
        artifact={data.artifact}
        busy={saveAction.loading}
        error={saveAction.error ? saveAction.error.userMessage : ''}
        onSave={save}
        onCancel={onCancel}
      />
    </div>
  )
}

export default ArtifactEditShell
