import { useState, useEffect, useRef } from 'react'
import SourceCard from '../components/SourceCard'

const ALLOWED_EXTENSIONS = ['.pdf', '.pptx', '.docx', '.md', '.txt']
const MAX_FILE_BYTES = 25 * 1024 * 1024   // 25 MB

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Returns an error string if the file is invalid, null if valid
function validateFile(file) {
  const ext = '.' + file.name.split('.').pop().toLowerCase()
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return `"${ext}" files are not supported. Accepted: ${ALLOWED_EXTENSIONS.join(', ')}`
  }
  if (file.size > MAX_FILE_BYTES) {
    return `File is too large (${formatFileSize(file.size)}). Maximum is 25 MB.`
  }
  return null
}

function Dashboard() {
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Form visibility and shared fields
  const [showForm, setShowForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)

  // Mode: 'paste' uses the textarea; 'file' uses the upload zone
  const [mode, setMode] = useState('paste')

  // Paste mode state
  const [newContent, setNewContent] = useState('')

  // File mode state
  const [selectedFile, setSelectedFile] = useState(null)
  const [fileError, setFileError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)

  const fetchSources = async () => {
    try {
      const res = await fetch('/api/sources')
      setSources(await res.json())
    } catch {
      setError('Could not load sources. Is the backend running? (npm run dev)')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchSources() }, [])

  // ── File selection helpers ────────────────────────────────────────────────

  function handleFileSelect(file) {
    if (!file) return
    const validationError = validateFile(file)
    if (validationError) {
      setFileError(validationError)
      setSelectedFile(null)
    } else {
      setFileError(null)
      setSelectedFile(file)
      // Auto-fill title from filename if the user hasn't typed one yet
      if (!newTitle.trim()) {
        setNewTitle(file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '))
      }
    }
  }

  function handleDragOver(e) {
    e.preventDefault()
    setDragOver(true)
  }

  function handleDragLeave() {
    setDragOver(false)
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    handleFileSelect(e.dataTransfer.files[0])
  }

  // ── Mode switch ───────────────────────────────────────────────────────────

  function switchMode(next) {
    setMode(next)
    setCreateError(null)
    setFileError(null)
    setSelectedFile(null)
    setNewContent('')
  }

  // ── Form reset ────────────────────────────────────────────────────────────

  function resetForm() {
    setShowForm(false)
    setNewTitle('')
    setNewContent('')
    setSelectedFile(null)
    setFileError(null)
    setCreateError(null)
    setMode('paste')
    setDragOver(false)
  }

  // ── Submit: paste mode ────────────────────────────────────────────────────

  async function submitPaste() {
    const res = await fetch('/api/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle, content: newContent })
    })
    return res.json()
  }

  // ── Submit: file upload mode ──────────────────────────────────────────────
  // FormData is used instead of JSON because files can't be serialised to JSON.
  // The browser automatically sets the Content-Type to multipart/form-data
  // with the correct boundary — do NOT set it manually or the upload breaks.

  async function submitFile() {
    const formData = new FormData()
    formData.append('title', newTitle)
    formData.append('file', selectedFile)   // 'file' must match multer's .single('file')

    const res = await fetch('/api/sources/upload', {
      method: 'POST',
      body: formData
      // No Content-Type header — browser sets multipart/form-data + boundary automatically
    })
    return res.json()
  }

  // ── Main submit handler ───────────────────────────────────────────────────

  async function handleAddSource(e) {
    e.preventDefault()
    setCreating(true)
    setCreateError(null)

    try {
      const data = mode === 'file' ? await submitFile() : await submitPaste()

      if (data.slug) {
        setSources(prev => [data, ...prev])
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

  // ── Submit button label ───────────────────────────────────────────────────

  function submitLabel() {
    if (creating) return mode === 'file' ? 'Uploading...' : 'Saving...'
    return mode === 'file' ? 'Upload source' : 'Save source'
  }

  function submitDisabled() {
    if (creating) return true
    if (!newTitle.trim()) return true
    if (mode === 'paste') return !newContent.trim()
    if (mode === 'file') return !selectedFile
    return true
  }

  // ─────────────────────────────────────────────────────────────────────────

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

      {/* ── Add source form ──────────────────────────────────────────────── */}
      {showForm && (
        <div className="card add-source-form">
          <h2>New source</h2>

          {/* Mode toggle — paste text vs upload a file */}
          <div className="source-mode-toggle">
            <button
              type="button"
              className={`source-mode-btn ${mode === 'paste' ? 'active' : ''}`}
              onClick={() => switchMode('paste')}
            >
              Paste text
            </button>
            <button
              type="button"
              className={`source-mode-btn ${mode === 'file' ? 'active' : ''}`}
              onClick={() => switchMode('file')}
            >
              Upload file
            </button>
          </div>

          <form onSubmit={handleAddSource}>
            {/* Title — shared between both modes */}
            <div className="form-group">
              <label htmlFor="srcTitle">Title</label>
              <input
                id="srcTitle"
                type="text"
                placeholder="e.g. Onboarding Module 1 Notes"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                required
                autoFocus={mode === 'paste'}
              />
            </div>

            {/* Paste mode: textarea */}
            {mode === 'paste' && (
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
            )}

            {/* File mode: drag-drop zone */}
            {mode === 'file' && (
              <div className="form-group">
                <label>Source file</label>

                {/* Clicking the zone triggers the hidden file input */}
                <div
                  className={`upload-zone ${dragOver ? 'drag-over' : ''} ${selectedFile ? 'has-file' : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  {/* Hidden native file input — styled via the zone div above */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ALLOWED_EXTENSIONS.join(',')}
                    style={{ display: 'none' }}
                    onChange={e => handleFileSelect(e.target.files[0])}
                  />

                  {selectedFile ? (
                    <>
                      <span className="upload-zone-icon">✅</span>
                      <div className="upload-zone-file-info">
                        <span className="upload-zone-filename">{selectedFile.name}</span>
                        <span className="upload-zone-filesize">{formatFileSize(selectedFile.size)}</span>
                      </div>
                      <button
                        type="button"
                        className="upload-zone-change"
                        onClick={e => { e.stopPropagation(); setSelectedFile(null) }}
                      >
                        Change file
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="upload-zone-icon">📂</span>
                      <p className="upload-zone-label">
                        Drop a file here, or click to browse
                      </p>
                      <p className="upload-zone-hint">
                        {ALLOWED_EXTENSIONS.join(', ')} · max 25 MB
                      </p>
                    </>
                  )}
                </div>

                {fileError && (
                  <div className="status-message error" style={{ marginTop: '8px' }}>
                    {fileError}
                  </div>
                )}
              </div>
            )}

            {createError && (
              <div className="status-message error">{createError}</div>
            )}

            <div className="form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitDisabled()}
              >
                {submitLabel()}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={resetForm}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Source grid ──────────────────────────────────────────────────── */}
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
