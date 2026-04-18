// routes/settings.js — read and write ~/Byte/settings.json
// The settings file lives OUTSIDE the repo in the user's home folder,
// so the API key is never accidentally committed to Git.

const express = require('express')
const router = express.Router()
const fs = require('fs')
const path = require('path')
const os = require('os')

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
  ensureByteDir()

  if (!fs.existsSync(SETTINGS_FILE)) {
    return res.json({ hasApiKey: false, apiKeyPreview: '' })
  }

  const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
  res.json({
    hasApiKey: !!settings.apiKey,
    apiKeyPreview: settings.apiKey
      ? '••••••••' + settings.apiKey.slice(-4)
      : ''
  })
})

// POST /api/settings
// Accepts { apiKey: "sk-ant-..." } and writes it to ~/Byte/settings.json.
router.post('/', (req, res) => {
  const { apiKey } = req.body
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({ error: 'apiKey is required' })
  }

  ensureByteDir()
  fs.writeFileSync(
    SETTINGS_FILE,
    JSON.stringify({ apiKey: apiKey.trim() }, null, 2)
  )

  res.json({ success: true })
})

module.exports = router
