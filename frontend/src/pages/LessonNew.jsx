import { useState, useEffect, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/apiFetch'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { actionPropsFor } from '../lib/errorActions'
import LoadingState from '../components/LoadingState'
import ErrorState from '../components/ErrorState'
import './Lesson.css'
import { usePageTitle } from '../hooks/usePageTitle'

// LessonNew: start a lesson from a topic and one or more project sources.
//
// The FIRST source you tick is the primary source. Its learner context
// (role, experience, use case) prefills the lesson, and any artifact
// generated for the lesson is saved in its folder. Submitting creates the
// lesson and then asks the model for a blueprint. If the blueprint call
// fails the lesson still exists; the lesson page offers a Retry.
function LessonNew() {
  usePageTitle('New lesson')
  const { projectSlug } = useParams()
  const navigate = useNavigate()

  const [sources, setSources] = useState(null)
  const [selected, setSelected] = useState([])   // slugs, in the order ticked
  const [topic, setTopic] = useState('')
  const [title, setTitle] = useState('')
  const [perGenerationPrompt, setPerGenerationPrompt] = useState('')
  const [perGenerationObjective, setPerGenerationObjective] = useState('')
  const [budget, setBudget] = useState(10)

  const loadAction = useAsyncAction()
  const createAction = useAsyncAction()

  const loadSources = useCallback(async () => {
    const data = await loadAction.run(() => api.get(`/api/projects/${projectSlug}/sources`))
    if (Array.isArray(data)) setSources(data)
  }, [loadAction, projectSlug])

  useEffect(() => {
    loadSources()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSlug])

  function toggle(slug) {
    setSelected(prev => (prev.includes(slug) ? prev.filter(s => s !== slug) : [...prev, slug]))
  }

  const handleSubmit = useCallback(async (e) => {
    if (e) e.preventDefault()
    const result = await createAction.run(async () => {
      const created = await api.post(`/api/projects/${projectSlug}/lessons`, {
        topic,
        title,
        sources: selected,
        perGenerationPrompt,
        perGenerationObjective,
        timeBudgetMinutes: Number(budget),
      })
      const id = created.lesson.id
      try {
        await api.post(`/api/projects/${projectSlug}/lessons/${id}/blueprint/generate`)
        return { id }
      } catch (err) {
        // The lesson exists; let the lesson page offer a retry.
        return { id, notice: err }
      }
    })
    if (result) {
      navigate(`/projects/${projectSlug}/lessons/${result.id}`, {
        state: result.notice ? { notice: result.notice } : undefined,
      })
    }
  }, [createAction, projectSlug, topic, title, selected, perGenerationPrompt, perGenerationObjective, budget, navigate])

  const canSubmit = topic.trim() && selected.length > 0 && !createAction.loading

  return (
    <div className="lesson-new-page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Projects</Link>
        <span className="breadcrumb-sep" aria-hidden="true">›</span>
        <Link to={`/projects/${projectSlug}`}>{projectSlug}</Link>
        <span className="breadcrumb-sep" aria-hidden="true">›</span>
        <span>New lesson</span>
      </nav>

      <div className="card add-source-form">
        <h1>New lesson</h1>
        <p className="sidebar-help">
          A lesson is a short text-first document with one objective. You can add flip cards,
          knowledge checks, and scenarios to it afterwards.
        </p>

        {loadAction.loading && !sources && <LoadingState message="Loading sources..." />}
        {loadAction.error && !sources && (
          <ErrorState message={loadAction.error.userMessage} onRetry={loadSources} />
        )}

        {sources && sources.length === 0 && (
          <div className="empty-state">
            <p>
              This project has no sources yet.{' '}
              <Link to={`/projects/${projectSlug}/sources/new`}>Add a source</Link> first.
            </p>
          </div>
        )}

        {sources && sources.length > 0 && (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="lessonTopic">Topic</label>
              <input
                id="lessonTopic"
                type="text"
                placeholder="e.g. Check changeover time before you lock a schedule"
                value={topic}
                onChange={e => setTopic(e.target.value)}
                disabled={createAction.loading}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label htmlFor="lessonTitle">
                Title <span className="label-optional">(optional, defaults to the topic)</span>
              </label>
              <input
                id="lessonTitle"
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                disabled={createAction.loading}
              />
            </div>

            <div className="form-group">
              <label>Sources</label>
              <p className="field-help">
                Pick the sources this lesson draws on. The first one you pick is the primary
                source: it prefills the learner context, and artifacts made for the lesson are
                saved with it.
              </p>
              <ul className="lesson-source-list">
                {sources.map(s => {
                  const order = selected.indexOf(s.slug)
                  return (
                    <li key={s.slug}>
                      <label className="lesson-source-item">
                        <input
                          type="checkbox"
                          checked={order !== -1}
                          onChange={() => toggle(s.slug)}
                          disabled={createAction.loading}
                        />
                        <span className="lesson-source-title">{s.title}</span>
                        {order === 0 && <span className="lesson-source-badge">Primary</span>}
                      </label>
                    </li>
                  )
                })}
              </ul>
            </div>

            <div className="form-group">
              <label htmlFor="lessonBudget">Time budget</label>
              <select
                id="lessonBudget"
                value={budget}
                onChange={e => setBudget(e.target.value)}
                disabled={createAction.loading}
              >
                {[5, 6, 7, 8, 9, 10].map(m => (
                  <option key={m} value={m}>{m} minutes{m === 10 ? ' (maximum)' : ''}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="lessonPrompt">
                Per-generation prompt <span className="label-optional">(optional)</span>
              </label>
              <textarea
                id="lessonPrompt"
                rows={2}
                placeholder="Steering for this lesson only."
                value={perGenerationPrompt}
                onChange={e => setPerGenerationPrompt(e.target.value)}
                disabled={createAction.loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="lessonObjective">
                Target learning objective <span className="label-optional">(optional override)</span>
              </label>
              <textarea
                id="lessonObjective"
                rows={2}
                placeholder="Lock this lesson to one specific objective."
                value={perGenerationObjective}
                onChange={e => setPerGenerationObjective(e.target.value)}
                disabled={createAction.loading}
              />
            </div>

            {createAction.loading && (
              <LoadingState
                subtle
                message="Planning your lesson..."
                hint="This may take up to 30 seconds."
              />
            )}
            {createAction.error && (
              <ErrorState
                message={createAction.error.userMessage}
                onRetry={handleSubmit}
                {...actionPropsFor(createAction.error.errorType)}
              />
            )}

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
                {createAction.loading ? 'Planning...' : 'Plan the lesson'}
              </button>
              <Link to={`/projects/${projectSlug}`} className="btn btn-secondary">
                Cancel
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export default LessonNew
