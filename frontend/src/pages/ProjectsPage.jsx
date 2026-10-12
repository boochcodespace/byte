import { useState, useEffect, useCallback } from 'react'
import ProjectCard from '../components/ProjectCard'
import { api } from '../lib/apiFetch'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { actionPropsFor } from '../lib/errorActions'
import LoadingState from '../components/LoadingState'
import ErrorState from '../components/ErrorState'
import { usePageTitle } from '../hooks/usePageTitle'

// ProjectsPage is the new home: a grid of projects + an inline form
// to create a new project. Each project owns sources and a style guide.
function ProjectsPage() {
  usePageTitle('Projects')
  const [projects, setProjects] = useState([])

  const [showForm, setShowForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newStyleGuide, setNewStyleGuide] = useState('')
  const [newTargetAudience, setNewTargetAudience] = useState('')

  const loadAction = useAsyncAction()
  const createAction = useAsyncAction()

  const loadProjects = useCallback(async () => {
    const data = await loadAction.run(() => api.get('/api/projects'))
    if (Array.isArray(data)) setProjects(data)
  }, [loadAction])

  useEffect(() => {
    loadProjects()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function resetForm() {
    setShowForm(false)
    setNewTitle('')
    setNewDescription('')
    setNewStyleGuide('')
    setNewTargetAudience('')
    createAction.clearError()
  }

  const handleCreateProject = useCallback(async (e) => {
    if (e) e.preventDefault()
    const data = await createAction.run(() => api.post('/api/projects', {
      title: newTitle,
      description: newDescription,
      styleGuide: newStyleGuide,
      targetAudience: newTargetAudience,
    }))
    if (data) {
      setProjects(prev => [data, ...prev])
      resetForm()
    }
    // on error, form fields stay intact so the user can retry
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createAction, newTitle, newDescription, newStyleGuide, newTargetAudience])

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

            {createAction.error && (
              <ErrorState
                message={createAction.error.userMessage}
                onRetry={handleCreateProject}
                {...actionPropsFor(createAction.error.errorType)}
              />
            )}

            <div className="form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={createAction.loading || !newTitle.trim()}
              >
                {createAction.loading ? 'Creating...' : 'Create project'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={resetForm}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loadAction.loading ? (
        <LoadingState message="Loading projects..." />
      ) : loadAction.error ? (
        <ErrorState
          message={loadAction.error.userMessage}
          onRetry={loadProjects}
          {...actionPropsFor(loadAction.error.errorType)}
        />
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
