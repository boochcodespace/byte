import { useState, useEffect } from 'react'
import SourceCard from '../components/SourceCard'

// Dashboard: the home view showing all sources in a grid.
// On first launch the backend auto-seeds one example source.
function Dashboard() {
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // "Add new source" form state
  const [showForm, setShowForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)

  // Load all sources when the page mounts
  const fetchSources = async () => {
    try {
      const res = await fetch('/api/sources')
      const data = await res.json()
      setSources(data)
    } catch {
      setError('Could not load sources. Is the backend running? (npm run dev)')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchSources() }, [])

  const handleAddSource = async (e) => {
    e.preventDefault()
    setCreating(true)
    setCreateError(null)

    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle, content: newContent })
      })
      const data = await res.json()

      if (data.slug) {
        // Prepend the new source so it appears at the top
        setSources(prev => [data, ...prev])
        setShowForm(false)
        setNewTitle('')
        setNewContent('')
      } else {
        setCreateError(data.error || 'Failed to create source.')
      }
    } catch {
      setCreateError('Could not reach the backend.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1>Sources</h1>
          <p className="dashboard-subtitle">Your source content library</p>
        </div>
        {!showForm && (
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>
            + Add new source
          </button>
        )}
      </div>

      {/* Add source form — shown inline above the grid */}
      {showForm && (
        <div className="card add-source-form">
          <h2>New source</h2>
          <form onSubmit={handleAddSource}>
            <div className="form-group">
              <label htmlFor="srcTitle">Title</label>
              <input
                id="srcTitle"
                type="text"
                placeholder="e.g. Onboarding Module 1 Notes"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="form-group">
              <label htmlFor="srcContent">Source content</label>
              <textarea
                id="srcContent"
                placeholder="Paste your source material here — SME notes, transcript, technical doc, etc."
                value={newContent}
                onChange={e => setNewContent(e.target.value)}
                rows={10}
                required
              />
            </div>
            {createError && (
              <div className="status-message error">{createError}</div>
            )}
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating ? 'Saving...' : 'Save source'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => { setShowForm(false); setCreateError(null) }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Source grid */}
      {loading ? (
        <div className="loading">Loading sources...</div>
      ) : error ? (
        <div className="status-message error">{error}</div>
      ) : sources.length === 0 ? (
        <div className="empty-state">
          <p>No sources yet. Click <strong>+ Add new source</strong> to get started.</p>
        </div>
      ) : (
        <div className="source-grid">
          {sources.map(source => (
            <SourceCard key={source.slug} source={source} />
          ))}
        </div>
      )}
    </div>
  )
}

export default Dashboard
