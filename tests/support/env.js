// Shared test environment for every suite in tests/.
//
// What it gives a test:
//   HOME           a throwaway home folder, so the real ~/Byte is never touched
//   startEnv()     starts the backend (and, for browser suites, the Vite dev
//                  server) on that HOME, after checking the ports are free
//   stopEnv()      stops them, including grandchild processes, and removes HOME
//   launchBrowser  Chromium for browser suites (see `npm run test:a11y:setup`)
//
// The port guard refuses to run when `npm run dev` is using ports 3001 or 5173,
// so a test run can never fight with, or change, a running Byte.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const REPO = path.resolve(__dirname, '..', '..')
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'byte-test-'))
const SHOT = path.join(os.tmpdir(), 'byte-test-shots')
fs.mkdirSync(SHOT, { recursive: true })

const API_HEALTH = 'http://127.0.0.1:3001/api/health'
const APP_URL = 'http://localhost:5173/'
const children = []

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function waitFor(url) {
  for (let i = 0; i < 80; i++) { try { await fetch(url); return } catch { await sleep(250) } }
  throw new Error('Timed out waiting for ' + url)
}

async function assertPortFree(url, what) {
  let up = false
  try { await fetch(url); up = true } catch { /* nothing is listening: good */ }
  if (up) throw new Error(`${what} is already running (${url}). Stop \`npm run dev\` before running the tests.`)
}

// mock: the suite's own fake AI model server (an http.Server). Pass port if it is not 4010.
// backendEnv: extra environment variables for the backend.
// captureLogs: keep the backend's output, readable through env.logs() (used to
// prove that secrets never reach the logs).
let captured = ''
async function startEnv({ ui = false, mock, mockPort = 4010, backendEnv = {}, captureLogs = false } = {}) {
  await assertPortFree(API_HEALTH, 'The Byte backend')
  if (ui) await assertPortFree(APP_URL, 'The Byte frontend')
  if (mock) await new Promise(r => mock.listen(mockPort, r))
  const backend = spawn('node', ['server.js'], {
    cwd: path.join(REPO, 'backend'),
    env: { ...process.env, HOME, ...backendEnv },
    stdio: captureLogs ? ['ignore', 'pipe', 'pipe'] : 'ignore',
    detached: true,
  })
  if (captureLogs) {
    backend.stdout.on('data', d => { captured += d })
    backend.stderr.on('data', d => { captured += d })
  }
  children.push(backend)
  if (ui) children.push(spawn('npx', ['vite', '--port', '5173', '--strictPort'], { cwd: path.join(REPO, 'frontend'), env: process.env, stdio: 'ignore', detached: true }))
  await waitFor(API_HEALTH)
  if (ui) await waitFor(APP_URL)
}

async function stopEnv(mock) {
  // Each child leads its own process group (npx starts Vite as a grandchild),
  // so kill the whole group, then wait for the ports to come free.
  for (const c of children) { try { process.kill(-c.pid, 'SIGTERM') } catch { /* already gone */ } }
  children.length = 0
  try { if (mock) mock.close() } catch { /* already closed */ }
  for (let i = 0; i < 40; i++) {
    let busy = false
    for (const u of [API_HEALTH, APP_URL]) { try { await fetch(u); busy = true } catch { /* free */ } }
    if (!busy) break
    await sleep(250)
  }
  fs.rmSync(HOME, { recursive: true, force: true })
}

async function launchBrowser() {
  const { chromium } = require('playwright-core')
  try {
    return await chromium.launch({ executablePath: process.env.BYTE_TEST_CHROMIUM || undefined })
  } catch (err) {
    throw new Error('Chromium is not installed for the test suite. Run: npm run test:a11y:setup\n' + err.message)
  }
}

const logs = () => captured

module.exports = { REPO, HOME, SHOT, sleep, waitFor, startEnv, stopEnv, launchBrowser, logs }
