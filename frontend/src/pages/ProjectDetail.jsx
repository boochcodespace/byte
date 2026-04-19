import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import SourceCard from '../components/SourceCard'

// ProjectDetail: a single project's view.
// Left column: sources grid. Right sidebar: three steering panels
// (Style Guide, Custom Instructions, Target Audience) — each inherited
// by every artifact generated within this project.
function ProjectDetail() {
  const { projectSlug } = useParams()
  const navigate = useNavigate()

  const [project, setProject] = useState(null)
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState(null)

  // Editable sidebar fields — each panel has its own independent save state.
  const [styleGuide, setStyleGuide] = useState('')
  const [customInstructions, setCustomInstructions] = useState('')
  const [targetAudience, setTargetAudience] = useState('')

  const [savingStyle, setSavingStyle] = useState(false)
  const [savedStyle, setSavedStyle] = useState(false)
  const [savingInstructions, setSavingInstructions] = useState(false)
  const [savedInstructions, setSavedInstructions] = useState(false)
  const [savingAudience, setSavingAudience] = useState(false)
  const [savedAudience, setSavedAudience] = useState(false)

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch(`/api/projects/${projectSlug}`).then(r => r.json()),
      fetch(`/api/projects/${projectSlug}/sources`).then(r => r.json())
    ])
      .then(([proj, srcs]) => {
        if (proj.error) throw new Error(proj.error)
        setProject(proj)
        setStyleGuide(proj.styleGuide || '')
        setCustomInstructions(proj.customInstructions || '')
        setTargetAudience(proj.targetAudience || '')
        setSources(Array.isArray(srcs) ? srcs : [])
        setLoading(false)
      })
      .catch(err => {
        setPageError(err.message || 'Could not load project.')
        setLoading(false)
      })
  }, [projectSlug])

  async function saveField(field, value, setSaving, setSaved) {
    setSaving(true)
    try {
      await fetch(`/api/projects/${projectSlug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value })
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await fetch(`/api/projects/${projectSlug}`, { method: 'DELETE' })
      navigate('/')
    } catch {
      setDeleting(false)
    }
  }

  if (loading) return <div className="loading">Loading project...</div>
  if (pageError) return <div className="status-message error">{pageError}</div>

  return (
    <div className="project-detail">
      <nav className="breadcrumb">
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
              <button className="btn btn-danger btn-sm" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting...' : 'Yes, delete'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="source-detail-layout">
        <div className="source-main">
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
                onClick={() => saveField('styleGuide', styleGuide, setSavingStyle, setSavedStyle)}
                disabled={savingStyle}
              >
                {savedStyle ? 'Saved ✓' : savingStyle ? 'Saving...' : 'Save'}
              </button>
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
                onClick={() => saveField('customInstructions', customInstructions, setSavingInstructions, setSavedInstructions)}
                disabled={savingInstructions}
              >
                {savedInstructions ? 'Saved ✓' : savingInstructions ? 'Saving...' : 'Save'}
              </button>
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
                onClick={() => saveField('targetAudience', targetAudience, setSavingAudience, setSavedAudience)}
                disabled={savingAudience}
              >
                {savedAudience ? 'Saved ✓' : savingAudience ? 'Saving...' : 'Save'}
              </button>
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
