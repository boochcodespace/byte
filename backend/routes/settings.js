// routes/settings.js — read and write ~/Byte/settings.json
// The settings file lives OUTSIDE the repo in the user's home folder,
// so the API key is never accidentally committed to Git.
//
// Settings hold the user's AI provider choice: { provider, apiKey,
// model, baseUrl }. The provider list and defaults come from
// lib/llm/config.js, so the Settings page never hard-codes them.

const express = require('express')
const router = express.Router()
const { ERROR_TYPES, sendOk, sendError, mapSdkError } = require('../lib/error-types')
const {
  PROVIDERS,
  listProviders,
  readSettings,
  writeSettings,
  withPreset,
} = require('../lib/llm/config')

// GET /api/settings
// Returns the saved provider choice, whether a key is saved, and a
// masked preview (last 4 chars only). We never send the full key back
// to the frontend — it stays on disk only.
router.get('/', (req, res) => {
  try {
    const saved = readSettings()
    const current = withPreset(saved)
    return sendOk(res, {
      provider: current.provider,
      model: saved.model || '',
      baseUrl: saved.baseUrl || '',
      hasApiKey: !!saved.apiKey,
      apiKeyPreview: saved.apiKey ? '••••••••' + saved.apiKey.slice(-4) : '',
      providers: listProviders(),
    })
  } catch (err) {
    const { errorType, debug } = mapSdkError(err)
    console.error('[settings:get]', errorType, debug || err)
    return sendError(res, errorType, { debug })
  }
})

// POST /api/settings
// Accepts { provider, apiKey?, model?, baseUrl? } and saves it.
// A blank apiKey keeps the saved one, but only when the provider is
// unchanged: a key for one provider must never be sent to another.
router.post('/', (req, res) => {
  try {
    const body = req.body || {}
    const provider = body.provider || 'anthropic'
    const preset = PROVIDERS[provider]
    if (!preset) {
      return sendError(res, ERROR_TYPES.VALIDATION, { userMessage: 'Choose a supported AI provider.' })
    }

    const saved = readSettings()
    const savedProvider = withPreset(saved).provider
    const typedKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
    const apiKey = typedKey || (provider === savedProvider ? saved.apiKey || '' : '')

    if (preset.requiresKey && !apiKey) {
      return sendError(res, ERROR_TYPES.VALIDATION, { userMessage: 'API key is required.' })
    }

    const model = typeof body.model === 'string' ? body.model.trim() : ''
    if (!model && !preset.defaultModel) {
      return sendError(res, ERROR_TYPES.VALIDATION, {
        userMessage: 'Enter the name of the model to use.',
      })
    }

    const baseUrl = preset.baseUrlEditable
      ? (typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '') || preset.baseUrl
      : ''
    if (preset.baseUrlEditable && !baseUrl) {
      return sendError(res, ERROR_TYPES.VALIDATION, {
        userMessage: 'Enter the base URL of your provider.',
      })
    }

    writeSettings({ provider, apiKey, model, baseUrl })
    return sendOk(res, { success: true })
  } catch (err) {
    const { errorType, debug } = mapSdkError(err)
    console.error('[settings:save]', errorType, debug || err)
    return sendError(res, errorType, { debug })
  }
})

module.exports = router
