import { useState, useRef, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/apiFetch'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { actionPropsFor } from '../lib/errorActions'
import LoadingState from '../components/LoadingState'
import ErrorState from '../components/ErrorState'
import { usePageTitle } from '../hooks/usePageTitle'

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

// AddSource: dedicated page for adding a source to a specific project.
// Supports two input modes — paste text or upload a file.
function AddSource() {
  usePageTitle('Add a source')
  const { projectSlug } = useParams()
  const navigate = useNavigate()

  // Shared form fields
  const [newTitle, setNewTitle] = useState('')
  const createAction = useAsyncAction()

  // Mode: 'paste' uses the textarea; 'file' uses the upload zone
  const [mode, setMode] = useState('paste')

  // Paste mode
  const [newContent, setNewContent] = useState('')

  // File mode
  const [selectedFile, setSelectedFile] = useState(null)
  const [fileError, setFileError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)

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

  function switchMode(next) {
    setMode(next)
    createAction.clearError()
    setFileError(null)
    setSelectedFile(null)
    setNewContent('')
  }

  const submitPaste = useCallback(() => {
    return api.post(`/api/projects/${projectSlug}/sources`, {
      title: newTitle,
      content: newContent,
    })
  }, [projectSlug, newTitle, newContent])

  const submitFile = useCallback(() => {
    // FormData is used instead of JSON because files can't be serialised to JSON.
    // The browser automatically sets the Content-Type to multipart/form-data
    // with the correct boundary — do NOT set it manually or the upload breaks.
    const formData = new FormData()
    formData.append('title', newTitle)
    formData.append('file', selectedFile)   // 'file' must match multer's .single('file')
    return api.post(`/api/projects/${projectSlug}/sources/upload`, formData)
  }, [projectSlug, newTitle, selectedFile])

  const handleSubmit = useCallback(async (e) => {
    if (e) e.preventDefault()
    const submit = mode === 'file' ? submitFile : submitPaste
    const data = await createAction.run(submit)
    if (data?.slug) {
      navigate(`/projects/${projectSlug}/sources/${data.slug}`)
    }
    // on error, form state is preserved so the user can fix + retry
  }, [mode, submitFile, submitPaste, createAction, navigate, projectSlug])

  function submitLabel() {
    if (createAction.loading) return mode === 'file' ? 'Uploading...' : 'Saving...'
    return mode === 'file' ? 'Upload source' : 'Save source'
  }

  function submitDisabled() {
    if (createAction.loading) return true
    if (!newTitle.trim()) return true
    if (mode === 'paste') return !newContent.trim()
    if (mode === 'file') return !selectedFile
    return true
  }

  return (
    <div className="add-source-page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Projects</Link>
        <span className="breadcrumb-sep">›</span>
        <Link to={`/projects/${projectSlug}`}>{projectSlug}</Link>
        <span className="breadcrumb-sep">›</span>
        <span>Add source</span>
      </nav>

      <div className="card add-source-form">
        <h1>New source</h1>

        <div className="source-mode-toggle">
          <button
            type="button"
            className={`source-mode-btn ${mode === 'paste' ? 'active' : ''}`}
            onClick={() => switchMode('paste')}
            disabled={createAction.loading}
          >
            Paste text
          </button>
          <button
            type="button"
            className={`source-mode-btn ${mode === 'file' ? 'active' : ''}`}
            onClick={() => switchMode('file')}
            disabled={createAction.loading}
          >
            Upload file
          </button>
        </div>

        <form onSubmit={handleSubmit}>
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
              disabled={createAction.loading}
            />
          </div>

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
                disabled={createAction.loading}
              />
            </div>
          )}

          {mode === 'file' && (
            <div className="form-group">
              <label>Source file</label>

              <div
                className={`upload-zone ${dragOver ? 'drag-over' : ''} ${selectedFile ? 'has-file' : ''}`}
                onClick={() => !createAction.loading && fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ALLOWED_EXTENSIONS.join(',')}
                  style={{ display: 'none' }}
                  onChange={e => handleFileSelect(e.target.files[0])}
                  disabled={createAction.loading}
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
                      disabled={createAction.loading}
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
                <div className="status-message error" role="alert" style={{ marginTop: '8px' }}>
                  {fileError}
                </div>
              )}
            </div>
          )}

          {createAction.loading && (
            <LoadingState
              subtle
              message={mode === 'file' ? 'Uploading and parsing file...' : 'Saving source...'}
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
            <button type="submit" className="btn btn-primary" disabled={submitDisabled()}>
              {submitLabel()}
            </button>
            <Link to={`/projects/${projectSlug}`} className="btn btn-secondary">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}

export default AddSource
