#!/usr/bin/env node
// smoke-test.js — one-file sanity check for the Byte backend
//
// Run from the repo root:
//   node smoke-test.js
//
// What it checks:
//   1. ~/Byte/settings.json exists and contains an API key
//   2. A minimal Claude API call succeeds (does NOT generate a full artifact)
//
// Expected output on success:
//   ✓ API key found in ~/Byte/settings.json
//   ✓ Claude API responded: BYTE_OK
//   Smoke test passed. Byte is ready to generate artifacts.

const fs = require('fs')
const path = require('path')
const os = require('os')

// The Anthropic SDK lives in backend/node_modules
// so we require it from there when running from the repo root.
const Anthropic = require(path.join(__dirname, 'backend', 'node_modules', '@anthropic-ai', 'sdk'))

const SETTINGS_FILE = path.join(os.homedir(), 'Byte', 'settings.json')

async function main() {
  console.log('Byte smoke test\n─────────────────────────────────')

  // ── Check 1: API key on disk ──────────────────────────────────
  if (!fs.existsSync(SETTINGS_FILE)) {
    console.error('FAIL  ~/Byte/settings.json not found.')
    console.error('      Fix: start the app and go to Settings to save your API key.')
    process.exit(1)
  }

  let settings
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
  } catch {
    console.error('FAIL  ~/Byte/settings.json could not be parsed.')
    process.exit(1)
  }

  if (!settings.apiKey) {
    console.error('FAIL  apiKey is empty in ~/Byte/settings.json.')
    console.error('      Fix: go to Settings in the app and paste your Anthropic API key.')
    process.exit(1)
  }

  console.log('✓  API key found in ~/Byte/settings.json')

  // ── Check 2: Claude API call ──────────────────────────────────
  const anthropic = new Anthropic({ apiKey: settings.apiKey })

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16,
      messages: [
        { role: 'user', content: 'Reply with exactly the text: BYTE_OK' }
      ]
    })

    const text = response.content[0].text.trim()
    console.log(`✓  Claude API responded: ${text}`)
    console.log('\nSmoke test passed. Byte is ready to generate artifacts.')
  } catch (err) {
    console.error(`FAIL  Claude API call failed: ${err.message}`)
    console.error('      Check: is your API key valid? Does your Anthropic account have credits?')
    process.exit(1)
  }
}

main()
