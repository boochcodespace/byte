// backend/lib/llm/config.js
//
// Single source of truth for which AI providers Byte supports and how
// the user's choice is stored. The frontend Settings page reads the
// PROVIDERS list from GET /api/settings, so adding a provider here is
// the only change needed for it to appear in the UI.
//
// Two adapters cover everything:
//   anthropic          — Anthropic's native Messages API
//   openai-compatible  — the OpenAI chat-completions format, which
//                        OpenAI, Gemini, OpenRouter, Groq and local
//                        servers like Ollama all speak
//
// Settings live in ~/Byte/settings.json, outside the repo, so keys are
// never committed. Shape:
//   { provider, apiKey, model, baseUrl }
// Installs from before multi-provider support hold only { apiKey };
// those resolve to provider "anthropic".

const fs = require('fs')
const path = require('path')
const os = require('os')

const BYTE_DIR = path.join(os.homedir(), 'Byte')
const SETTINGS_FILE = path.join(BYTE_DIR, 'settings.json')

// Model defaults are conveniences, not guarantees: providers retire
// models. The Settings page lets the user override the model for every
// provider. An empty defaultModel means the user must type one.
const PROVIDERS = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    adapter: 'anthropic',
    requiresKey: true,
    baseUrl: '',
    baseUrlEditable: false,
    defaultModel: 'claude-sonnet-4-6',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI (ChatGPT)',
    adapter: 'openai-compatible',
    requiresKey: true,
    baseUrl: 'https://api.openai.com/v1',
    baseUrlEditable: false,
    defaultModel: 'gpt-4o',
    // OpenAI-only: newer models reject max_tokens, and JSON mode is
    // supported. Other providers get the plain, widely supported form.
    maxTokensParam: 'max_completion_tokens',
    jsonMode: true,
  },
  gemini: {
    id: 'gemini',
    label: 'Google (Gemini)',
    adapter: 'openai-compatible',
    requiresKey: true,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    baseUrlEditable: false,
    defaultModel: 'gemini-2.5-flash',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter (many models)',
    adapter: 'openai-compatible',
    requiresKey: true,
    baseUrl: 'https://openrouter.ai/api/v1',
    baseUrlEditable: false,
    defaultModel: '',
  },
  local: {
    id: 'local',
    label: 'Local model (Ollama, LM Studio)',
    adapter: 'openai-compatible',
    requiresKey: false,
    baseUrl: 'http://localhost:11434/v1',
    baseUrlEditable: true,
    defaultModel: '',
  },
  custom: {
    id: 'custom',
    label: 'Other (OpenAI-compatible)',
    adapter: 'openai-compatible',
    requiresKey: true,
    baseUrl: '',
    baseUrlEditable: true,
    defaultModel: '',
  },
}

const DEFAULT_PROVIDER = 'anthropic'

// What the frontend needs to render the picker. Never includes keys.
function listProviders() {
  return Object.values(PROVIDERS).map(p => ({
    id: p.id,
    label: p.label,
    requiresKey: p.requiresKey,
    baseUrl: p.baseUrl,
    baseUrlEditable: p.baseUrlEditable,
    defaultModel: p.defaultModel,
  }))
}

function readSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return {}
  return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
}

function writeSettings(settings) {
  if (!fs.existsSync(BYTE_DIR)) fs.mkdirSync(BYTE_DIR, { recursive: true })
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
}

// Merge saved settings with the provider's preset into one flat config.
// Fields the user did not set fall back to the preset.
function withPreset(saved) {
  const provider = PROVIDERS[saved.provider] ? saved.provider : DEFAULT_PROVIDER
  const preset = PROVIDERS[provider]
  return {
    provider,
    adapter: preset.adapter,
    requiresKey: preset.requiresKey,
    apiKey: saved.apiKey || '',
    model: (saved.model || '').trim() || preset.defaultModel,
    baseUrl: preset.baseUrlEditable
      ? (saved.baseUrl || '').trim() || preset.baseUrl
      : preset.baseUrl,
    maxTokensParam: preset.maxTokensParam || 'max_tokens',
    jsonMode: !!preset.jsonMode,
  }
}

// Returns the config generation should use, or a { problem } object
// naming what is missing so the route can pick the right error:
//   'api_key' → missing_api_key,  'model' → invalid_model
function resolveLlmConfig() {
  const config = withPreset(readSettings())
  if (config.requiresKey && !config.apiKey) return { problem: 'api_key' }
  if (!config.model) return { problem: 'model' }
  if (config.adapter === 'openai-compatible' && !config.baseUrl) {
    return { problem: 'model' }
  }
  return { config }
}

module.exports = {
  PROVIDERS,
  listProviders,
  readSettings,
  writeSettings,
  withPreset,
  resolveLlmConfig,
}
