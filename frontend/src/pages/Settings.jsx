import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/apiFetch'
import { useAsyncAction } from '../hooks/useAsyncAction'
import LoadingState from '../components/LoadingState'
import ErrorState from '../components/ErrorState'

// Settings page: lets the user paste their Anthropic API key.
// The key is sent to the backend and saved in ~/Byte/settings.json.
// It never goes into the browser's localStorage or this repository.
function Settings() {
  const [apiKey, setApiKey] = useState('')
  const [keyInfo, setKeyInfo] = useState(null)   // { hasApiKey, apiKeyPreview }
  const [successMessage, setSuccessMessage] = useState(null)

  const loadAction = useAsyncAction()
  const saveAction = useAsyncAction()

  const loadSettings = useCallback(async () => {
    const data = await loadAction.run(() => api.get('/api/settings'))
    if (data) setKeyInfo(data)
  }, [loadAction])

  // On mount, ask the backend whether a key is already saved
  useEffect(() => {
    loadSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSave = useCallback(async (e) => {
    if (e) e.preventDefault()
    setSuccessMessage(null)
    const result = await saveAction.run(() => api.post('/api/settings', { apiKey }))
    if (result) {
      setSuccessMessage("API key saved. You're ready to generate artifacts.")
      setKeyInfo({ hasApiKey: true, apiKeyPreview: '••••••••' + apiKey.trim().slice(-4) })
      setApiKey('')
    }
  }, [apiKey, saveAction])

  return (
    <div className="settings-page">
      <h1>Settings</h1>
      <p className="settings-description">Configure Byte for your machine.</p>

      <div className="card settings-card">
        <h2>Anthropic API Key</h2>
        <p className="settings-help">
          Your key is stored in <code>~/Byte/settings.json</code> on this machine only.
          It is never committed to this Git repository and is only sent to Anthropic's API
          when you click Generate.
        </p>

        {loadAction.loading && !keyInfo && (
          <LoadingState subtle message="Checking for saved key..." />
        )}

        {loadAction.error && !keyInfo && (
          <ErrorState
            message={loadAction.error.userMessage}
            onRetry={loadSettings}
          />
        )}

        {/* Show a badge if a key is already stored */}
        {keyInfo?.hasApiKey && (
          <div className="current-key-info">
            <span className="key-badge">Key saved: {keyInfo.apiKeyPreview}</span>
          </div>
        )}

        <form onSubmit={handleSave}>
          <div className="form-group">
            <label htmlFor="apiKey">
              {keyInfo?.hasApiKey ? 'Replace key' : 'Paste API key'}
            </label>
            <input
              id="apiKey"
              type="password"
              placeholder="sk-ant-..."
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={saveAction.loading}
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!apiKey.trim() || saveAction.loading}
          >
            {saveAction.loading ? 'Saving...' : 'Save key'}
          </button>
        </form>

        {successMessage && (
          <div className="status-message success">{successMessage}</div>
        )}

        {saveAction.error && (
          <ErrorState
            message={saveAction.error.userMessage}
            onRetry={handleSave}
          />
        )}
      </div>

      <p className="settings-footer-note">
        Don't have a key?{' '}
        <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer">
          Get one at console.anthropic.com →
        </a>
      </p>
    </div>
  )
}

export default Settings
