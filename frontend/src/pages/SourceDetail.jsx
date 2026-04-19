import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getRenderer, DEFAULT_TYPE } from '../artifact-renderers/registry'
import { api } from '../lib/apiFetch'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { actionPropsFor } from '../lib/errorActions'
import LoadingState from '../components/LoadingState'
import ErrorState from '../components/ErrorState'

// SourceDetail: the full page for one source within a project.
// Left column: editable source text + artifact list + artifact preview.
// Right column (sidebar): learner context fields + generate controls.
function SourceDetail() {
  const { projectSlug, slug } = useParams()
  const sourceUrl = `/api/projects/${projectSlug}/sources/${slug}`

  const [source, setSource] = useState(null)
  const [content, setContent] = useState('')
  const [context, setContext] = useState({
    role: '',
    experience: '',
    useCase: '',
    learningObjectives: ''
  })

  const [saveLabel, setSaveLabel] = useState('Save')
  const [selectedArtifact, setSelectedArtifact] = useState(null)

  const [artifactType, setArtifactType] = useState('flip-card-deck')

  // Ephemeral per-generation fields — cleared after a successful generation
  // so they don't silently carry over to the next one. Preserved on error
  // so the user doesn't lose their typed steering after a failed call.
  const [perGenerationPrompt, setPerGenerationPrompt] = useState('')
  const [perGenerationObjective, setPerGenerationObjective] = useState('')

  const loadAction = useAsyncAction()
  const saveAction = useAsyncAction()
  const generateAction = useAsyncAction()

  const loadSource = useCallback(async () => {
    const data = await loadAction.run(() => api.get(sourceUrl))
    if (!data) return
    setSource(data)
    setContent(data.content || '')
    setContext({
      role: data.context?.role || '',
      experience: data.context?.experience || '',
      useCase: data.context?.useCase || '',
      learningObjectives: data.context?.learningObjectives || ''
    })
    if (data.artifacts?.length > 0) {
      setSelectedArtifact(data.artifacts[0])
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
      <nav className="breadcrumb">
        <Link to="/">Projects</Link>
        <span className="breadcrumb-sep">›</span>
        <Link to={`/projects/${projectSlug}`}>{projectSlug}</Link>
        <span className="breadcrumb-sep">›</span>
        <span>{source.title}</span>
      </nav>

      <h1>{source.title}</h1>

      <div className="source-detail-layout">
        <div className="source-main">
          <div className="card">
            <div className="card-header">
              <h2>Source content</h2>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleSave}
                disabled={saveAction.loading}
              >
                {saveAction.loading ? 'Saving...' : saveLabel}
              </button>
            </div>
            <textarea
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
                {source.artifacts.map((artifact, i) => (
                  <div
                    key={artifact.folder || i}
                    className={`artifact-item ${selectedArtifact === artifact ? 'active' : ''}`}
                    onClick={() => setSelectedArtifact(artifact)}
                  >
                    <div className="artifact-item-icon">🃏</div>
                    <div>
                      <div className="artifact-item-type">Flip Card Deck</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedArtifact && (() => {
            // Older artifacts have no `type` field — fall back to the
            // default (flip-card-deck) so nothing on disk looks broken
            // after the refactor.
            const Renderer = getRenderer(selectedArtifact.type || DEFAULT_TYPE)
            return (
              <div className="card artifact-preview">
                <Renderer artifact={selectedArtifact} />
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
              <label>Role</label>
              <input
                type="text"
                placeholder="e.g. Team Lead, Sales Rep, New Hire"
                value={context.role || ''}
                onChange={e => setContext(c => ({ ...c, role: e.target.value }))}
              />
            </div>

            <div className="form-group">
              <label>Experience level</label>
              <select
                value={context.experience || ''}
                onChange={e => setContext(c => ({ ...c, experience: e.target.value }))}
              >
                <option value="">Select level...</option>
                <option value="Beginner">Beginner</option>
                <option value="Intermediate">Intermediate</option>
                <option value="Advanced">Advanced</option>
                <option value="Expert">Expert</option>
              </select>
            </div>

            <div className="form-group">
              <label>Use case</label>
              <input
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
              <label>Artifact type</label>
              <select
                value={artifactType}
                onChange={e => setArtifactType(e.target.value)}
                disabled={generateAction.loading}
              >
                <option value="flip-card-deck">Flip Card Deck</option>
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
              {generateAction.loading ? '✨ Generating...' : '✨ Generate'}
            </button>

            {generateAction.loading && (
              <LoadingState
                subtle
                message="Calling Claude..."
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
