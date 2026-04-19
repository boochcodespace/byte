import { useState, useEffect } from 'react'
import ProjectCard from '../components/ProjectCard'

// ProjectsPage is the new home: a grid of projects + an inline form
// to create a new project. Each project owns sources and a style guide.
function ProjectsPage() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [showForm, setShowForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newStyleGuide, setNewStyleGuide] = useState('')
  const [newTargetAudience, setNewTargetAudience] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)

  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then(data => {
        setProjects(Array.isArray(data) ? data : [])
        setLoading(false)
      })
      .catch(() => {
        setError('Could not load projects. Is the backend running? (npm run dev)')
        setLoading(false)
      })
  }, [])

  function resetForm() {
    setShowForm(false)
    setNewTitle('')
    setNewDescription('')
    setNewStyleGuide('')
    setNewTargetAudience('')
    setCreateError(null)
  }

  async function handleCreateProject(e) {
    e.preventDefault()
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle,
          description: newDescription,
          styleGuide: newStyleGuide,
          targetAudience: newTargetAudience
        })
      })
      const data = await res.json()
      if (data.slug) {
        setProjects(prev => [data, ...prev])
        resetForm()
      } else {
        setCreateError(data.error || 'Something went wrong.')
      }
    } catch {
      setCreateError('Could not reach the backend.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="projects-page">
      <div className="dashboard-header">
        <div>
          <h1>Projects</h1>
          <p className="dashboard-subtitle">Group sources by audience, programme, or topic</p>
        </div>
        {!showForm && (
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>
            + New project
          </button>
        )}
      </div>

      {showForm && (
        <div className="card add-source-form">
          <h2>New project</h2>
          <form onSubmit={handleCreateProject}>
            <div className="form-group">
              <label htmlFor="projTitle">Title</label>
              <input
                id="projTitle"
                type="text"
                placeholder="e.g. Onboarding 2026"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="form-group">
              <label htmlFor="projDesc">
                Description <span className="label-optional">(optional)</span>
              </label>
              <input
                id="projDesc"
                type="text"
                placeholder="What's this project about?"
                value={newDescription}
                onChange={e => setNewDescription(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="projAudience">
                Target audience <span className="label-optional">(optional)</span>
              </label>
              <input
                id="projAudience"
                type="text"
                placeholder="e.g. New sales reps with under 6 months experience"
                value={newTargetAudience}
                onChange={e => setNewTargetAudience(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="projStyle">
                Style guide <span className="label-optional">(optional)</span>
              </label>
              <textarea
                id="projStyle"
                placeholder="Tone, terminology preferences, or formatting rules applied to every artifact in this project..."
                value={newStyleGuide}
                onChange={e => setNewStyleGuide(e.target.value)}
                rows={4}
              />
            </div>

            {createError && <div className="status-message error">{createError}</div>}

            <div className="form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={creating || !newTitle.trim()}
              >
                {creating ? 'Creating...' : 'Create project'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={resetForm}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="loading">Loading projects...</div>
      ) : error ? (
        <div className="status-message error">{error}</div>
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <p>No projects yet. Click <strong>+ New project</strong> to get started.</p>
        </div>
      ) : (
        <div className="project-grid">
          {projects.map(project => (
            <ProjectCard key={project.slug} project={project} />
          ))}
        </div>
      )}
    </div>
  )
}

export default ProjectsPage
