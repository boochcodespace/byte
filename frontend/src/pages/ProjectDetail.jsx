import { useState, useEffect, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import SourceCard from '../components/SourceCard'
import { api } from '../lib/apiFetch'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { actionPropsFor } from '../lib/errorActions'
import LoadingState from '../components/LoadingState'
import ErrorState from '../components/ErrorState'
import { usePageTitle } from '../hooks/usePageTitle'

// ProjectDetail: a single project's view.
// Left column: sources grid. Right sidebar: three steering panels
// (Style Guide, Custom Instructions, Target Audience) — each inherited
// by every artifact generated within this project.
function ProjectDetail() {
  const { projectSlug } = useParams()
  const navigate = useNavigate()

  const [project, setProject] = useState(null)
  usePageTitle(project?.title)
  const [sources, setSources] = useState([])
  const [lessons, setLessons] = useState([])

  // Editable sidebar fields — each panel has its own independent save state.
  const [styleGuide, setStyleGuide] = useState('')
  const [customInstructions, setCustomInstructions] = useState('')
  const [targetAudience, setTargetAudience] = useState('')

  // A single useAsyncAction per sidebar panel keeps loading/error state
  // independent across the three save buttons.
  const styleAction = useAsyncAction()
  const instructionsAction = useAsyncAction()
  const audienceAction = useAsyncAction()

  // "Saved ✓" flashes — separate from action loading so the checkmark
  // stays visible after the save resolves.
  const [savedStyle, setSavedStyle] = useState(false)
  const [savedInstructions, setSavedInstructions] = useState(false)
  const [savedAudience, setSavedAudience] = useState(false)

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const loadAction = useAsyncAction()
  const deleteAction = useAsyncAction()

  const loadProject = useCallback(async () => {
    const data = await loadAction.run(async () => {
      const [proj, srcs, lessonList] = await Promise.all([
        api.get(`/api/projects/${projectSlug}`),
        api.get(`/api/projects/${projectSlug}/sources`),
        // The lessons list is a convenience; the page still works without it.
        api.get(`/api/projects/${projectSlug}/lessons`).catch(() => []),
      ])
      return { proj, srcs, lessonList }
    })
    if (!data) return
    setLessons(Array.isArray(data.lessonList) ? data.lessonList : [])
    setProject(data.proj)
    setStyleGuide(data.proj.styleGuide || '')
    setCustomInstructions(data.proj.customInstructions || '')
    setTargetAudience(data.proj.targetAudience || '')
    setSources(Array.isArray(data.srcs) ? data.srcs : [])
  }, [loadAction, projectSlug])

  useEffect(() => {
    loadProject()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSlug])

  async function saveField(field, value, action, setSaved) {
    const result = await action.run(() =>
      api.put(`/api/projects/${projectSlug}`, { [field]: value })
    )
    if (result) {
      setSaved(true)
      setTimeout(() => setSaved(false), 6000)
    }
  }

  const handleDelete = useCallback(async () => {
    const result = await deleteAction.run(() => api.delete(`/api/projects/${projectSlug}`))
    if (result) navigate('/')
  }, [deleteAction, projectSlug, navigate])

  if (loadAction.loading && !project) {
    return <LoadingState message="Loading project..." />
  }
  if (loadAction.error && !project) {
    return (
      <ErrorState
        message={loadAction.error.userMessage}
        onRetry={loadProject}
        {...actionPropsFor(loadAction.error.errorType)}
      />
    )
  }
  if (!project) return null

  return (
    <div className="project-detail">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Projects</Link>
        <span className="breadcrumb-sep">›</span>
        <span>{project.title}</span>
      </nav>

      <div className="dashboard-header">
        <div>
          <h1>{project.title}</h1>
          {project.description && (
            <p className="dashboard-subtitle">{project.description}</p>
          )}
        </div>
        <div className="project-detail-actions">
          <Link to={`/projects/${projectSlug}/sources/new`} className="btn btn-primary">
            + Add source
          </Link>
          {!showDeleteConfirm ? (
            <button
              className="btn btn-danger"
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete project
            </button>
          ) : (
            <div className="delete-confirm">
              <span>Delete this project and all its sources?</span>
              <button
                className="btn btn-danger btn-sm"
                onClick={handleDelete}
                disabled={deleteAction.loading}
              >
                {deleteAction.loading ? 'Deleting...' : 'Yes, delete'}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleteAction.loading}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {deleteAction.error && (
        <ErrorState
          message={deleteAction.error.userMessage}
          onRetry={handleDelete}
          {...actionPropsFor(deleteAction.error.errorType)}
        />
      )}

      <div className="source-detail-layout">
        <div className="source-main">
          <div className="card lessons-panel">
            <div className="lessons-panel-head">
              <h2>Lessons</h2>
              <Link to={`/projects/${projectSlug}/lessons/new`} className="btn btn-primary btn-sm">
                + New lesson
              </Link>
            </div>
            {lessons.length === 0 ? (
              <p className="sidebar-help">
                A lesson turns a topic and your sources into one short, text-first document you can
                add flip cards, knowledge checks, and scenarios to.
              </p>
            ) : (
              lessons.map(l => (
                <Link key={l.id} to={`/projects/${projectSlug}/lessons/${l.id}`} className="lesson-row">
                  <span className="lesson-row-title">{l.title}</span>
                  <span className="lesson-row-meta">
                    {l.status === 'drafted' ? 'Drafted' : l.status === 'approved' ? 'Blueprint approved' : 'Blueprint'}
                  </span>
                  {l.status === 'drafted' && (
                    <span className={`lesson-row-meta ${l.over_budget ? 'lesson-row-over' : ''}`}>
                      {l.total_minutes} / {l.time_budget_minutes} min{l.over_budget ? ' · over' : ''}
                    </span>
                  )}
                </Link>
              ))
            )}
          </div>

          {sources.length === 0 ? (
            <div className="empty-state">
              <p>No sources yet. Click <strong>+ Add source</strong> to get started.</p>
            </div>
          ) : (
            <div className="source-grid">
              {sources.map(source => (
                <SourceCard
                  key={source.slug}
                  source={source}
                  projectSlug={projectSlug}
                />
              ))}
            </div>
          )}
        </div>

        <div className="source-sidebar">
          {/* Style Guide — controls voice/tone/writing rules */}
          <div className="sidebar-panel card">
            <div className="sidebar-panel-header">
              <h2>Style guide</h2>
            </div>
            <div className="sidebar-panel-body">
              <p className="sidebar-help">
                How should content be written in this project? Voice, tone,
                writing conventions, and any words or patterns to avoid.
              </p>
              <textarea
                className="sidebar-textarea"
                placeholder="e.g. Active voice. No corporate jargon. Use 'planner' not 'user'."
                value={styleGuide}
                onChange={e => setStyleGuide(e.target.value)}
                rows={6}
              />
              <button
                className="btn btn-secondary btn-sm sidebar-save-btn"
                onClick={() => saveField('styleGuide', styleGuide, styleAction, setSavedStyle)}
                disabled={styleAction.loading}
              >
                {savedStyle ? 'Saved ✓' : styleAction.loading ? 'Saving...' : 'Save'}
              </button>
              <span className="sr-only" role="status">{savedStyle ? 'Style guide saved.' : ''}</span>
              {styleAction.error && (
                <ErrorState
                  message={styleAction.error.userMessage}
                  onRetry={() => saveField('styleGuide', styleGuide, styleAction, setSavedStyle)}
                  {...actionPropsFor(styleAction.error.errorType)}
                />
              )}
            </div>
          </div>

          {/* Custom Instructions — controls what to focus on (content emphasis) */}
          <div className="sidebar-panel card">
            <div className="sidebar-panel-header">
              <h2>Custom instructions</h2>
            </div>
            <div className="sidebar-panel-body">
              <p className="sidebar-help">
                What should Byte focus on in this project? Describe the content
                emphasis, pedagogical angle, or framing that every artifact
                should reflect. <em>Different from Style Guide, which is about
                voice. This is about what to focus on.</em>
              </p>
              <textarea
                className="sidebar-textarea"
                placeholder="e.g. Every artifact should emphasise real-world planner decisions and link concepts to downstream supply chain impact."
                value={customInstructions}
                onChange={e => setCustomInstructions(e.target.value)}
                rows={6}
              />
              <button
                className="btn btn-secondary btn-sm sidebar-save-btn"
                onClick={() => saveField('customInstructions', customInstructions, instructionsAction, setSavedInstructions)}
                disabled={instructionsAction.loading}
              >
                {savedInstructions ? 'Saved ✓' : instructionsAction.loading ? 'Saving...' : 'Save'}
              </button>
              <span className="sr-only" role="status">{savedInstructions ? 'Custom instructions saved.' : ''}</span>
              {instructionsAction.error && (
                <ErrorState
                  message={instructionsAction.error.userMessage}
                  onRetry={() => saveField('customInstructions', customInstructions, instructionsAction, setSavedInstructions)}
                  {...actionPropsFor(instructionsAction.error.errorType)}
                />
              )}
            </div>
          </div>

          {/* Target Audience — who the project is for */}
          <div className="sidebar-panel card">
            <div className="sidebar-panel-header">
              <h2>Target audience</h2>
            </div>
            <div className="sidebar-panel-body">
              <p className="sidebar-help">
                Who is this project for? Describe them like you would in a
                design brief — their role, context, and daily reality.
              </p>
              <textarea
                className="sidebar-textarea"
                placeholder="e.g. New sales reps with under 6 months experience, working B2B mid-market deals."
                value={targetAudience}
                onChange={e => setTargetAudience(e.target.value)}
                rows={4}
              />
              <button
                className="btn btn-secondary btn-sm sidebar-save-btn"
                onClick={() => saveField('targetAudience', targetAudience, audienceAction, setSavedAudience)}
                disabled={audienceAction.loading}
              >
                {savedAudience ? 'Saved ✓' : audienceAction.loading ? 'Saving...' : 'Save'}
              </button>
              <span className="sr-only" role="status">{savedAudience ? 'Target audience saved.' : ''}</span>
              {audienceAction.error && (
                <ErrorState
                  message={audienceAction.error.userMessage}
                  onRetry={() => saveField('targetAudience', targetAudience, audienceAction, setSavedAudience)}
                  {...actionPropsFor(audienceAction.error.errorType)}
                />
              )}
            </div>
          </div>

          <div className="sidebar-panel card">
            <div className="project-stats">
              <span className="section-count">
                {sources.length} source{sources.length !== 1 ? 's' : ''}
              </span>
              {project.artifactCount > 0 && (
                <>
                  {' · '}
                  <span className="section-count">
                    {project.artifactCount} artifact{project.artifactCount !== 1 ? 's' : ''}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ProjectDetail
