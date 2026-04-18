import { useState, useEffect } from 'react'

// Settings page: lets the user paste their Anthropic API key.
// The key is sent to the backend and saved in ~/Byte/settings.json.
// It never goes into the browser's localStorage or this repository.
function Settings() {
  const [apiKey, setApiKey] = useState('')
  const [keyInfo, setKeyInfo] = useState(null)   // { hasApiKey, apiKeyPreview }
  const [status, setStatus] = useState(null)      // { type: 'success'|'error', message }
  const [saving, setSaving] = useState(false)

  // On mount, ask the backend whether a key is already saved
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => setKeyInfo(data))
      .catch(() => setKeyInfo({ hasApiKey: false, apiKeyPreview: '' }))
  }, [])

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setStatus(null)

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey })
      })
      const data = await res.json()

      if (data.success) {
        setStatus({ type: 'success', message: 'API key saved. You\'re ready to generate artifacts.' })
        setKeyInfo({ hasApiKey: true, apiKeyPreview: '••••••••' + apiKey.trim().slice(-4) })
        setApiKey('')
      } else {
        setStatus({ type: 'error', message: data.error || 'Failed to save.' })
      }
    } catch {
      setStatus({ type: 'error', message: 'Could not reach the backend. Make sure npm run dev is running.' })
    } finally {
      setSaving(false)
    }
  }

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
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!apiKey.trim() || saving}
          >
            {saving ? 'Saving...' : 'Save key'}
          </button>
        </form>

        {status && (
          <div className={`status-message ${status.type}`}>{status.message}</div>
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
