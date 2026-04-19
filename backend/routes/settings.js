// routes/settings.js — read and write ~/Byte/settings.json
// The settings file lives OUTSIDE the repo in the user's home folder,
// so the API key is never accidentally committed to Git.

const express = require('express')
const router = express.Router()
const fs = require('fs')
const path = require('path')
const os = require('os')
const { ERROR_TYPES, sendOk, sendError, mapSdkError } = require('../lib/error-types')

// os.homedir() is the user's home folder: /Users/yourname on Mac, /home/yourname on Linux
const BYTE_DIR = path.join(os.homedir(), 'Byte')
const SETTINGS_FILE = path.join(BYTE_DIR, 'settings.json')

// Create ~/Byte/ if it doesn't exist yet
function ensureByteDir() {
  if (!fs.existsSync(BYTE_DIR)) {
    fs.mkdirSync(BYTE_DIR, { recursive: true })
  }
}

// GET /api/settings
// Returns whether a key is saved and a masked preview (last 4 chars only).
// We never send the full key back to the frontend — it stays on disk only.
router.get('/', (req, res) => {
  try {
    ensureByteDir()

    if (!fs.existsSync(SETTINGS_FILE)) {
      return sendOk(res, { hasApiKey: false, apiKeyPreview: '' })
    }

    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
    return sendOk(res, {
      hasApiKey: !!settings.apiKey,
      apiKeyPreview: settings.apiKey
        ? '••••••••' + settings.apiKey.slice(-4)
        : '',
    })
  } catch (err) {
    const { errorType, debug } = mapSdkError(err)
    console.error('[settings:get]', errorType, debug || err)
    return sendError(res, errorType, { debug })
  }
})

// POST /api/settings
// Accepts { apiKey: "sk-ant-..." } and writes it to ~/Byte/settings.json.
router.post('/', (req, res) => {
  try {
    const { apiKey } = req.body
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return sendError(res, ERROR_TYPES.VALIDATION, { userMessage: 'API key is required.' })
    }

    ensureByteDir()
    fs.writeFileSync(
      SETTINGS_FILE,
      JSON.stringify({ apiKey: apiKey.trim() }, null, 2)
    )

    return sendOk(res, { success: true })
  } catch (err) {
    const { errorType, debug } = mapSdkError(err)
    console.error('[settings:save]', errorType, debug || err)
    return sendError(res, errorType, { debug })
  }
})

module.exports = router
