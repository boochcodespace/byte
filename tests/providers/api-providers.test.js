// API: the AI provider layer, settings, and key handling
// Run by `npm run test:all`. Uses a mock AI model and a throwaway HOME.
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')

const env = require('../support/env')
const HOME = env.HOME
const MOCK_PORT = 4010
const API = 'http://127.0.0.1:3001/api'
const MOCK = `http://127.0.0.1:${MOCK_PORT}`

const DECK = {
  learning_objective: 'Identify the three scheduling constraints.',
  estimated_minutes: 3,
  visual_anchor_description: 'A diagram of the constraints.', alt_text: 'Constraints diagram',
  cards: [{ type: 'hook', front: 'Which constraint binds first?', back: 'Changeover time.' }],
  spaced_repetition_notes: 'None.',
}

// ── mock provider ──────────────────────────────────────────────────
let mode = 'ok'
let last = null
const mock = http.createServer((req, res) => {
  let raw = ''
  req.on('data', c => (raw += c))
  req.on('end', () => {
    last = { url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null }
    const send = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(obj))
    }
    if (mode === '401') return send(401, { error: { message: 'bad key' } })
    if (mode === '404') return send(404, { error: { message: 'model not found' } })
    if (mode === '429') return send(429, { error: { message: 'slow down' } })
    if (mode === '500') return send(500, { error: { message: 'boom' } })
    let text = JSON.stringify(DECK)
    if (mode === 'notjson') text = 'Sorry, here is some prose.'
    if (mode === 'badschema') text = JSON.stringify({ foo: 1 })
    if (mode === 'fenced') text = '```json\n' + JSON.stringify(DECK) + '\n```'
    if (req.url.endsWith('/messages')) return send(200, { content: [{ type: 'text', text }] })
    return send(200, { choices: [{ message: { content: text } }] })
  })
})

// ── helpers ────────────────────────────────────────────────────────
let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name) }
  else { fail++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : '') }
}
const j = async (method, p, body) => {
  const r = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return r.json()
}
const saveSettings = body => j('POST', '/settings', body)
const generate = () =>
  j('POST', '/projects/getting-started/sources/active-listening/artifacts/generate', {
    artifactType: 'flip-card-deck',
  })

async function main() {
  await env.startEnv({ mock, mockPort: MOCK_PORT, backendEnv: { ANTHROPIC_BASE_URL: MOCK }, captureLogs: true })
  const logs = env.logs

  try {
    console.log('A. fresh install')
    let s = await j('GET', '/settings')
    check('defaults to anthropic', s.data.provider === 'anthropic')
    check('6 providers listed', s.data.providers.length === 6)
    check('no key saved', s.data.hasApiKey === false)
    await j('GET', '/projects') // seeds getting-started
    let g = await generate()
    check('generate without key → missing_api_key', g.errorType === 'missing_api_key', g)

    console.log('B. legacy settings file ({apiKey} only)')
    fs.mkdirSync(path.join(HOME, 'Byte'), { recursive: true })
    fs.writeFileSync(path.join(HOME, 'Byte', 'settings.json'), JSON.stringify({ apiKey: 'sk-ant-legacy1234' }))
    s = await j('GET', '/settings')
    check('legacy resolves to anthropic with key', s.data.provider === 'anthropic' && s.data.hasApiKey)
    check('key masked', s.data.apiKeyPreview === '••••••••1234')

    console.log('C. anthropic adapter (regression path, via mock base URL)')
    mode = 'ok'
    g = await generate()
    check('anthropic generate ok', g.ok === true, g)
    check('hit /v1/messages', last.url.startsWith('/v1/messages'), last.url)
    check('sent configured model', last.body.model === 'claude-sonnet-4-6', last.body.model)
    check('artifact stamped with type', g.data?.type === 'flip-card-deck')
    mode = '401'
    g = await generate()
    check('anthropic 401 → invalid_api_key', g.errorType === 'invalid_api_key', g)

    console.log('D. local model, no key')
    mode = 'ok'
    let r = await saveSettings({ provider: 'local' })
    check('local without model rejected', r.ok === false && r.errorType === 'validation', r)
    r = await saveSettings({ provider: 'local', model: 'llama3', baseUrl: `${MOCK}/v1` })
    check('local saved without key', r.ok === true, r)
    g = await generate()
    check('local generate ok', g.ok === true, g)
    check('hit /v1/chat/completions', last.url === '/v1/chat/completions', last.url)
    check('no Authorization header', last.headers.authorization === undefined)
    check('model passed through', last.body.model === 'llama3')
    check('uses max_tokens', last.body.max_tokens === 4096 && last.body.max_completion_tokens === undefined)
    check('no JSON-mode param', last.body.response_format === undefined)
    check('system prompt sent', last.body.messages[0].role === 'system' && /generative engine inside Byte/.test(last.body.messages[0].content))
    check('user prompt sent', last.body.messages[1].role === 'user' && /flip card deck/i.test(last.body.messages[1].content))

    console.log('E. custom provider with key')
    r = await saveSettings({ provider: 'custom', apiKey: 'sk-test-9999', model: 'm1', baseUrl: `${MOCK}/v1/` })
    check('custom saved', r.ok === true, r)
    g = await generate()
    check('custom generate ok (trailing slash tolerated)', g.ok === true, g)
    check('Bearer header sent', last.headers.authorization === 'Bearer sk-test-9999')

    console.log('F. key handling across provider changes')
    r = await saveSettings({ provider: 'custom', model: 'm2', baseUrl: `${MOCK}/v1` })
    check('blank key keeps saved key, same provider', r.ok === true, r)
    await generate()
    check('kept key still sent', last.headers.authorization === 'Bearer sk-test-9999')
    r = await saveSettings({ provider: 'openai', model: 'gpt-4o' })
    check('switching provider does NOT reuse old key', r.ok === false && r.errorType === 'validation', r)
    r = await saveSettings({ provider: 'nope' })
    check('unknown provider rejected', r.ok === false && r.errorType === 'validation', r)
    s = await j('GET', '/settings')
    check('settings never expose full key', !JSON.stringify(s).includes('sk-test-9999'))

    console.log('G. error mapping through the OpenAI-compatible adapter')
    r = await saveSettings({ provider: 'custom', apiKey: 'sk-test-9999', model: 'm1', baseUrl: `${MOCK}/v1` })
    for (const [m, expected] of [
      ['401', 'invalid_api_key'], ['404', 'invalid_model'], ['429', 'rate_limit'],
      ['500', 'server_error'], ['notjson', 'malformed_json'], ['badschema', 'schema_validation'],
    ]) {
      mode = m
      g = await generate()
      check(`${m} → ${expected}`, g.ok === false && g.errorType === expected, g)
    }
    mode = 'fenced'
    g = await generate()
    check('fenced JSON still accepted', g.ok === true, g)
    mode = 'ok'
    await saveSettings({ provider: 'custom', apiKey: 'sk-test-9999', model: 'm1', baseUrl: 'http://127.0.0.1:4999/v1' })
    g = await generate()
    check('server down → network', g.ok === false && g.errorType === 'network', g)
    check('network message is provider-neutral', !/claude|anthropic/i.test(g.userMessage || ''), g.userMessage)

    console.log('H. no leakage of key into logs')
    check('key not in backend logs', !logs().includes('sk-test-9999'))
  } finally {
    await env.stopEnv(mock)
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
