import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/apiFetch'
import { useAsyncAction } from '../hooks/useAsyncAction'
import LoadingState from '../components/LoadingState'
import ErrorState from '../components/ErrorState'

// Suggest a provider from the shape of a pasted key. Only a hint: the
// dropdown stays the source of truth because prefixes overlap (OpenRouter
// keys also start with "sk-"). More specific prefixes are listed first.
const KEY_PREFIX_HINTS = [
  { prefix: 'sk-ant-', provider: 'anthropic' },
  { prefix: 'sk-or-', provider: 'openrouter' },
  { prefix: 'AIza', provider: 'gemini' },
  { prefix: 'sk-', provider: 'openai' },
]

function suggestProvider(key) {
  const trimmed = key.trim()
  return KEY_PREFIX_HINTS.find(h => trimmed.startsWith(h.prefix))?.provider || null
}

// Settings page: choose an AI provider and paste its API key.
// The provider list and defaults come from the backend, so a new
// provider needs no change here. Everything is saved in
// ~/Byte/settings.json; nothing goes into localStorage or this repo.
function Settings() {
  const [info, setInfo] = useState(null)   // GET /api/settings response
  const [provider, setProvider] = useState('anthropic')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [successMessage, setSuccessMessage] = useState(null)

  const loadAction = useAsyncAction()
  const saveAction = useAsyncAction()

  const applySaved = useCallback((data) => {
    setInfo(data)
    setProvider(data.provider)
    setModel(data.model || '')
    setBaseUrl(data.baseUrl || '')
  }, [])

  const loadSettings = useCallback(async () => {
    const data = await loadAction.run(() => api.get('/api/settings'))
    if (data) applySaved(data)
  }, [loadAction, applySaved])

  // On mount, ask the backend what is saved
  useEffect(() => {
    loadSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const preset = info?.providers.find(p => p.id === provider)
  // A saved key only counts for the provider it was saved under.
  const hasSavedKeyForProvider = !!info?.hasApiKey && info.provider === provider

  function handleProviderChange(nextId) {
    const next = info.providers.find(p => p.id === nextId)
    setProvider(nextId)
    setSuccessMessage(null)
    if (nextId === info.provider) {
      // Back to the saved provider: show what is actually saved
      setModel(info.model || '')
      setBaseUrl(info.baseUrl || '')
    } else {
      setModel('')
      setBaseUrl(next.baseUrl)
    }
  }

  const handleSave = useCallback(async (e) => {
    if (e) e.preventDefault()
    setSuccessMessage(null)
    const result = await saveAction.run(() =>
      api.post('/api/settings', { provider, apiKey, model, baseUrl })
    )
    if (result) {
      setSuccessMessage("Settings saved. You're ready to generate artifacts.")
      setApiKey('')
      await loadSettings()
    }
  }, [provider, apiKey, model, baseUrl, saveAction, loadSettings])

  const suggested = apiKey.trim() ? suggestProvider(apiKey) : null
  const suggestedLabel = suggested && suggested !== provider
    ? info?.providers.find(p => p.id === suggested)?.label
    : null

  const needsKey = preset?.requiresKey && !apiKey.trim() && !hasSavedKeyForProvider
  const needsModel = !model.trim() && !preset?.defaultModel
  const needsBaseUrl = preset?.baseUrlEditable && !baseUrl.trim()
  const canSave = !!preset && !needsKey && !needsModel && !needsBaseUrl && !saveAction.loading

  return (
    <div className="settings-page">
      <h1>Settings</h1>
      <p className="settings-description">Configure Byte for your machine.</p>

      <div className="card settings-card">
        <h2>AI provider</h2>
        <p className="settings-help">
          Byte works with Claude, ChatGPT, Gemini, and any model that speaks
          the OpenAI format, including models running on your own computer.
          Your key is stored in <code>~/Byte/settings.json</code> on this machine only.
          It is never committed to this Git repository and is only sent to your chosen
          provider when you click Generate.
        </p>

        {loadAction.loading && !info && (
          <LoadingState subtle message="Loading settings..." />
        )}

        {loadAction.error && !info && (
          <ErrorState
            message={loadAction.error.userMessage}
            onRetry={loadSettings}
          />
        )}

        {info && preset && (
          <form onSubmit={handleSave}>
            <div className="form-group">
              <label htmlFor="provider">Provider</label>
              <select
                id="provider"
                value={provider}
                onChange={e => handleProviderChange(e.target.value)}
                disabled={saveAction.loading}
              >
                {info.providers.map(p => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>

            {preset.requiresKey && (
              <div className="form-group">
                {hasSavedKeyForProvider && (
                  <div className="current-key-info">
                    <span className="key-badge">Key saved: {info.apiKeyPreview}</span>
                  </div>
                )}
                <label htmlFor="apiKey">
                  {hasSavedKeyForProvider ? 'Replace key' : 'Paste API key'}
                  {hasSavedKeyForProvider && <span className="label-optional"> (leave blank to keep)</span>}
                </label>
                <input
                  id="apiKey"
                  type="password"
                  placeholder="Paste your API key"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={saveAction.loading}
                />
                {suggestedLabel && (
                  <p className="field-help">
                    That looks like a {suggestedLabel} key.{' '}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleProviderChange(suggested)}
                    >
                      Switch to {suggestedLabel}
                    </button>
                  </p>
                )}
              </div>
            )}

            {!preset.requiresKey && (
              <p className="field-help">
                No API key needed. Make sure your local model server is running
                before you generate.
              </p>
            )}

            {preset.baseUrlEditable && (
              <div className="form-group">
                <label htmlFor="baseUrl">Base URL</label>
                <input
                  id="baseUrl"
                  type="text"
                  placeholder="e.g. http://localhost:11434/v1"
                  value={baseUrl}
                  onChange={e => setBaseUrl(e.target.value)}
                  spellCheck={false}
                  disabled={saveAction.loading}
                />
              </div>
            )}

            <div className="form-group">
              <label htmlFor="model">
                Model
                {preset.defaultModel && <span className="label-optional"> (optional)</span>}
              </label>
              <input
                id="model"
                type="text"
                placeholder={preset.defaultModel || 'Enter the model name, e.g. llama3.1'}
                value={model}
                onChange={e => setModel(e.target.value)}
                spellCheck={false}
                disabled={saveAction.loading}
              />
              <p className="field-help">
                {preset.defaultModel
                  ? `Leave blank to use ${preset.defaultModel}. Providers retire models over time, so enter a newer name here if this one stops working.`
                  : 'The exact model name your provider uses.'}
                {' '}Byte&apos;s output format is tuned on Claude. Other models work,
                but smaller ones may need a retry more often.
              </p>
            </div>

            <button type="submit" className="btn btn-primary" disabled={!canSave}>
              {saveAction.loading ? 'Saving...' : 'Save settings'}
            </button>
          </form>
        )}

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
        Need a key? Anthropic:{' '}
        <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer">console.anthropic.com</a>
        {' · '}OpenAI:{' '}
        <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">platform.openai.com</a>
        {' · '}Gemini:{' '}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">aistudio.google.com</a>
      </p>
    </div>
  )
}

export default Settings
