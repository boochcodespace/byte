import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import FlipCardDeck from '../components/FlipCardDeck'

// SourceDetail: the full page for one source within a project.
// Left column: editable source text + artifact list + artifact preview.
// Right column (sidebar): learner context fields + generate button.
function SourceDetail() {
  const { projectSlug, slug } = useParams()
  const sourceUrl = `/api/projects/${projectSlug}/sources/${slug}`

  const [source, setSource] = useState(null)
  const [content, setContent] = useState('')
  const [context, setContext] = useState({ role: '', experience: '', useCase: '' })
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState(null)

  const [saving, setSaving] = useState(false)
  const [saveLabel, setSaveLabel] = useState('Save')

  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState(null)

  const [artifactType, setArtifactType] = useState('flip-card-deck')
  const [selectedArtifact, setSelectedArtifact] = useState(null)

  // Load source on mount
  useEffect(() => {
    fetch(sourceUrl)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setSource(data)
        setContent(data.content || '')
        setContext(data.context || { role: '', experience: '', useCase: '' })
        if (data.artifacts?.length > 0) {
          setSelectedArtifact(data.artifacts[0])
        }
        setLoading(false)
      })
      .catch(err => {
        setPageError(err.message || 'Could not load source.')
        setLoading(false)
      })
  }, [sourceUrl])

  const handleSave = async () => {
    setSaving(true)
    setSaveLabel('Saving...')
    try {
      await fetch(sourceUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, context })
      })
      setSaveLabel('Saved ✓')
      setTimeout(() => setSaveLabel('Save'), 2000)
    } catch {
      setSaveLabel('Save failed')
      setTimeout(() => setSaveLabel('Save'), 2000)
    } finally {
      setSaving(false)
    }
  }

  // Save latest content/context to disk, then ask backend to generate
  const handleGenerate = async () => {
    setGenerating(true)
    setGenError(null)

    // Persist any unsaved edits first so the backend reads the latest text
    await fetch(sourceUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, context })
    }).catch(() => {})

    try {
      const res = await fetch(`${sourceUrl}/artifacts/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifactType })
      })
      const data = await res.json()

      if (data.error) {
        setGenError(data.error)
      } else {
        setSource(prev => ({
          ...prev,
          artifacts: [data, ...(prev.artifacts || [])]
        }))
        setSelectedArtifact(data)
      }
    } catch {
      setGenError('Could not reach the backend. Make sure npm run dev is running.')
    } finally {
      setGenerating(false)
    }
  }

  if (loading) return <div className="loading">Loading source...</div>
  if (pageError) return <div className="status-message error">{pageError}</div>

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
                disabled={saving}
              >
                {saveLabel}
              </button>
            </div>
            <textarea
              className="source-editor"
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={20}
            />
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
                      <div className="artifact-item-objective">{artifact.learning_objective}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedArtifact && (
            <div className="card artifact-preview">
              <FlipCardDeck artifact={selectedArtifact} />
            </div>
          )}
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
          </div>

          <div className="card generate-card">
            <h2>Generate artifact</h2>

            <div className="form-group">
              <label>Artifact type</label>
              <select
                value={artifactType}
                onChange={e => setArtifactType(e.target.value)}
              >
                <option value="flip-card-deck">Flip Card Deck</option>
              </select>
            </div>

            <button
              className="btn btn-primary generate-btn"
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? '✨ Generating...' : '✨ Generate'}
            </button>

            {generating && (
              <p className="generating-note">
                Calling Claude — takes about 10–20 seconds.
              </p>
            )}

            {genError && <div className="status-message error">{genError}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

export default SourceDetail
