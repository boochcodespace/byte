import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  getRenderer,
  getTypeMeta,
  ARTIFACT_TYPE_OPTIONS,
  DEFAULT_TYPE,
  EDITABLE_ARTIFACT_TYPES,
} from '../artifact-renderers/registry'
import ArtifactEditShell from '../components/ArtifactEditShell'
import { api } from '../lib/apiFetch'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { actionPropsFor } from '../lib/errorActions'
import LoadingState from '../components/LoadingState'
import ErrorState from '../components/ErrorState'
import { usePageTitle } from '../hooks/usePageTitle'

// Experience level is Novice / Practicing / Expert. Sources saved before
// the rename hold the old four-level values; map them for display so
// the select does not show blank. Mirrors the backend mapping in
// build-prompt-context.js.
const LEGACY_EXPERIENCE = {
  beginner: 'Novice',
  intermediate: 'Practicing',
  advanced: 'Practicing',
}

function normalizeExperience(value) {
  const key = (value || '').trim().toLowerCase()
  if (LEGACY_EXPERIENCE[key]) return LEGACY_EXPERIENCE[key]
  if (['novice', 'practicing', 'expert'].includes(key)) {
    return key.charAt(0).toUpperCase() + key.slice(1)
  }
  return ''
}

// SourceDetail: the full page for one source within a project.
// Left column: editable source text + artifact list + artifact preview.
// Right column (sidebar): learner context fields + generate controls.
function SourceDetail() {
  const { projectSlug, slug } = useParams()
  const sourceUrl = `/api/projects/${projectSlug}/sources/${slug}`

  const [source, setSource] = useState(null)
  usePageTitle(source?.title)
  const [content, setContent] = useState('')
  const [context, setContext] = useState({
    role: '',
    experience: '',
    useCase: '',
    learningObjectives: ''
  })

  const [saveLabel, setSaveLabel] = useState('Save')
  const [selectedArtifact, setSelectedArtifact] = useState(null)
  const [editingArtifact, setEditingArtifact] = useState(false)   // the text editor is open for the selected artifact
  const [announce, setAnnounce] = useState('')

  const [artifactType, setArtifactType] = useState('flip-card-deck')

  // Ephemeral per-generation fields — cleared after a successful generation
  // so they don't silently carry over to the next one. Preserved on error
  // so the user doesn't lose their typed steering after a failed call.
  const [perGenerationPrompt, setPerGenerationPrompt] = useState('')
  const [perGenerationObjective, setPerGenerationObjective] = useState('')

  const loadAction = useAsyncAction()
  const saveAction = useAsyncAction()
  const generateAction = useAsyncAction()

  const loadSource = useCallback(async (selectFolder) => {
    const data = await loadAction.run(() => api.get(sourceUrl))
    if (!data) return
    setSource(data)
    setContent(data.content || '')
    setContext({
      role: data.context?.role || '',
      experience: normalizeExperience(data.context?.experience),
      useCase: data.context?.useCase || '',
      learningObjectives: data.context?.learningObjectives || ''
    })
    if (data.artifacts?.length > 0) {
      setSelectedArtifact(
        (typeof selectFolder === 'string' && data.artifacts.find(a => a.folder === selectFolder)) || data.artifacts[0]
      )
    }
  }, [loadAction, sourceUrl])

  // Load source on mount
  useEffect(() => {
    loadSource()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceUrl])

  const handleSave = async () => {
    setSaveLabel('Saving...')
    const result = await saveAction.run(() => api.put(sourceUrl, { content, context }))
    if (result) {
      setSaveLabel('Saved ✓')
      setTimeout(() => setSaveLabel('Save'), 2000)
    } else {
      // saveAction.error is already populated; the button just resets
      setSaveLabel('Save')
    }
  }

  // Save latest content/context to disk, then ask backend to generate.
  // On error, the user's content, context, and per-generation fields
  // are left intact — they can fix the underlying issue and retry.
  const handleGenerate = useCallback(async () => {
    // Persist any unsaved edits first so the backend reads the latest text.
    // Silently ignore persistence failures here — generate will surface
    // its own error if it can't read the source.
    try {
      await api.put(sourceUrl, { content, context })
    } catch {
      // swallowed intentionally
    }

    const data = await generateAction.run(() =>
      api.post(`${sourceUrl}/artifacts/generate`, {
        artifactType,
        perGenerationPrompt,
        perGenerationObjective,
      })
    )
    if (!data) return  // error state already set on generateAction.error

    setSource(prev => ({
      ...prev,
      artifacts: [data, ...(prev.artifacts || [])]
    }))
    setSelectedArtifact(data)
    // Ephemeral per-generation fields reset only on success
    setPerGenerationPrompt('')
    setPerGenerationObjective('')
  }, [sourceUrl, content, context, artifactType, perGenerationPrompt, perGenerationObjective, generateAction])

  // ── Page-level load state ───────────────────────────────────────────
  if (loadAction.loading && !source) {
    return <LoadingState message="Loading source..." />
  }
  if (loadAction.error && !source) {
    return (
      <ErrorState
        message={loadAction.error.userMessage}
        onRetry={loadSource}
        {...actionPropsFor(loadAction.error.errorType)}
      />
    )
  }
  if (!source) return null

  return (
    <div className="source-detail">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Projects</Link>
        <span className="breadcrumb-sep" aria-hidden="true">›</span>
        <Link to={`/projects/${projectSlug}`}>{projectSlug}</Link>
        <span className="breadcrumb-sep" aria-hidden="true">›</span>
        <span>{source.title}</span>
      </nav>

      <h1>{source.title}</h1>

      <div className={`source-detail-layout${editingArtifact ? ' is-editing' : ''}`}>
        <div className="source-main">
          <div className="card">
            <div className="card-header">
              <h2 id="source-content-h">Source content</h2>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleSave}
                disabled={saveAction.loading}
              >
                {saveAction.loading ? 'Saving...' : saveLabel}
              </button>
            </div>
            <textarea
              id="source-content"
              aria-labelledby="source-content-h"
              className="source-editor"
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={20}
            />
            {saveAction.error && (
              <ErrorState
                message={saveAction.error.userMessage}
                onRetry={handleSave}
                {...actionPropsFor(saveAction.error.errorType)}
              />
            )}
          </div>

          {source.artifacts?.length > 0 && (
            <div className="artifacts-section card">
              <h2 style={{ marginBottom: '12px' }}>Generated artifacts</h2>
              <div className="artifacts-list">
                {source.artifacts.map((artifact, i) => {
                  const meta = getTypeMeta(artifact.type || DEFAULT_TYPE)
                  return (
                    <button
                      type="button"
                      key={artifact.folder || i}
                      className={`artifact-item ${selectedArtifact === artifact ? 'active' : ''}`}
                      aria-pressed={selectedArtifact === artifact}
                      onClick={() => { setSelectedArtifact(artifact); setEditingArtifact(false) }}
                    >
                      <span className="artifact-item-icon" aria-hidden="true">{meta.icon}</span>
                      <span>
                        <span className="artifact-item-type">{meta.label}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {selectedArtifact && (() => {
            // Older artifacts have no `type` field — fall back to the
            // default (flip-card-deck) so nothing on disk looks broken
            // after the refactor.
            const type = selectedArtifact.type || DEFAULT_TYPE
            const Renderer = getRenderer(type)
            const meta = getTypeMeta(type)
            const editable = EDITABLE_ARTIFACT_TYPES.has(type) && !!selectedArtifact.folder
            const closeEditor = () => {
              setEditingArtifact(false)
              setTimeout(() => document.querySelector('[data-focus-key="source-edit"]')?.focus(), 0)
            }
            return (
              <div className="card artifact-preview">
                <div className="sr-only" role="status" aria-live="polite">{announce}</div>
                {(editable || selectedArtifact.edited) && (
                  <div className="artifact-preview-top">
                    {selectedArtifact.edited && <span className="lesson-badge">Edited by you</span>}
                    {editable && !editingArtifact && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        data-focus-key="source-edit"
                        aria-label={`Edit ${meta.label.toLowerCase()}`}
                        onClick={() => setEditingArtifact(true)}
                      >
                        Edit
                      </button>
                    )}
                  </div>
                )}
                {editingArtifact ? (
                  <ArtifactEditShell
                    key={`${slug}/${selectedArtifact.folder}`}
                    projectSlug={projectSlug}
                    source={slug}
                    folder={selectedArtifact.folder}
                    onSaved={async resp => {
                      await loadSource(selectedArtifact.folder)
                      setAnnounce(resp.changed ? `Saved your changes to the ${meta.label.toLowerCase()}.` : `No changes to save in the ${meta.label.toLowerCase()}.`)
                      closeEditor()
                    }}
                    onCancel={closeEditor}
                    onCopy={async () => {
                      const copy = await api.post(`/api/projects/${projectSlug}/artifacts/${slug}/${selectedArtifact.folder}/copy`, {})
                      if (copy) {
                        await loadSource(copy.artifact)
                        setAnnounce('Made a copy. Now editing the copy.')
                      }
                    }}
                  />
                ) : (
                  <Renderer artifact={selectedArtifact} />
                )}
              </div>
            )
          })()}
        </div>

        <div className="source-sidebar">
          <div className="card">
            <h2>Learner context</h2>
            <p className="sidebar-help">
              Tailor artifacts to a specific learner.
              More context = more targeted output.
            </p>

            <div className="form-group">
              <label htmlFor="src-role">Role</label>
              <input id="src-role"
                type="text"
                placeholder="e.g. Team Lead, Sales Rep, New Hire"
                value={context.role || ''}
                onChange={e => setContext(c => ({ ...c, role: e.target.value }))}
              />
            </div>

            <div className="form-group">
              <label htmlFor="src-experience-level">Experience level</label>
              <select id="src-experience-level"
                value={context.experience || ''}
                onChange={e => setContext(c => ({ ...c, experience: e.target.value }))}
              >
                <option value="">Select level...</option>
                <option value="Novice">Novice</option>
                <option value="Practicing">Practicing</option>
                <option value="Expert">Expert</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="src-use-case">Use case</label>
              <input id="src-use-case"
                type="text"
                placeholder="e.g. Preparing for a difficult conversation"
                value={context.useCase || ''}
                onChange={e => setContext(c => ({ ...c, useCase: e.target.value }))}
              />
            </div>

            <div className="form-group">
              <label>
                Learning objectives <span className="label-optional">(optional)</span>
              </label>
              <p className="field-help">
                What this source is designed to teach. Paste or type one or more
                objectives. Byte will use these when generating. Leave blank to
                let Byte infer objectives from the content.
              </p>
              <textarea
                placeholder={'e.g. By the end, learners will be able to:\n1. Identify three demand signal types.\n2. Apply basic forecasting logic.'}
                value={context.learningObjectives || ''}
                onChange={e => setContext(c => ({ ...c, learningObjectives: e.target.value }))}
                rows={5}
              />
            </div>
          </div>

          <div className="card generate-card">
            <h2>Generate artifact</h2>

            <div className="form-group">
              <label htmlFor="src-artifact-type">Artifact type</label>
              <select id="src-artifact-type"
                value={artifactType}
                onChange={e => setArtifactType(e.target.value)}
                disabled={generateAction.loading}
              >
                {ARTIFACT_TYPE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>
                Per-generation prompt <span className="label-optional">(optional)</span>
              </label>
              <p className="field-help">
                Steering for THIS generation only. Not saved. Use for one-off
                adjustments like "focus on section 3" or "target a senior
                planner who already knows basics."
              </p>
              <textarea
                placeholder="e.g. Focus on the changeover time matrix section."
                value={perGenerationPrompt}
                onChange={e => setPerGenerationPrompt(e.target.value)}
                rows={3}
                disabled={generateAction.loading}
              />
            </div>

            <div className="form-group">
              <label>
                Target learning objective <span className="label-optional">(optional override)</span>
              </label>
              <p className="field-help">
                Lock THIS artifact to one specific objective. Overrides the
                source's learning objectives. Use when generating a different
                artifact from the same source for a different objective.
              </p>
              <textarea
                placeholder="e.g. Apply forecasting logic to a real planning decision."
                value={perGenerationObjective}
                onChange={e => setPerGenerationObjective(e.target.value)}
                rows={2}
                disabled={generateAction.loading}
              />
            </div>

            <button
              className="btn btn-primary generate-btn"
              onClick={handleGenerate}
              disabled={generateAction.loading}
            >
              <span aria-hidden="true">✨ </span>{generateAction.loading ? 'Generating...' : 'Generate'}
            </button>

            {generateAction.loading && (
              <LoadingState
                subtle
                message="Calling your AI model..."
                hint="This may take up to 30 seconds."
              />
            )}

            {generateAction.error && (
              <ErrorState
                message={generateAction.error.userMessage}
                onRetry={handleGenerate}
                {...actionPropsFor(generateAction.error.errorType)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default SourceDetail
