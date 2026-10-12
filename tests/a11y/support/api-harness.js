// Shared setup for the API accessibility suites: a mock AI model that records
// prompts, fixtures, and the backend on a throwaway HOME.
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { spawn } = require('child_process')

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'byte-a11y-'))
const API = 'http://127.0.0.1:3001/api'
const MOCK = 'http://127.0.0.1:4010'
const P = 'getting-started'
const PRIMARY = 'active-listening'
const SECOND = 'second-source'

let pass = 0, fail = 0
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS', name) } else { fail++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : '') }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(url) {
  for (let i = 0; i < 60; i++) { try { await fetch(url); return } catch { await sleep(250) } }
  throw new Error('timeout ' + url)
}

const opt = (text, correct, rationale) => ({ text, correct, rationale })
const DECK = { learning_objective: 'DECK-OBJ', estimated_minutes: 3, visual_anchor_description: 'd', alt_text: 'DECK-ALT',
  cards: [1, 2, 3, 4].map(i => ({ type: i === 1 ? 'hook' : i === 4 ? 'apply' : 'content', front: `front ${i} words here`, back: `back ${i} words here` })),
  spaced_repetition_notes: 'n' }
const KC = { learning_objective: 'KC-OBJ', estimated_minutes: 3, setup: 'You will check things.', apply_today: 'Next time X happens, do Y.',
  items: [1, 2, 3].map(i => ({ id: `q${i}`, bloom_level: 'Apply', difficulty: 'intermediate', stem: `STEM-${i} what do you do first?`,
    options: [opt(`KEY-${i} one`, true, `R-KEY-${i}`), opt(`D1-${i} two`, false, `R-D1-${i}`), opt(`D2-${i} three`, false, `R-D2-${i}`)] })) }
const SCEN = { learning_objective: 'SCEN-OBJ', estimated_minutes: 3, setup: 'You will decide.', start_node: 'n1', apply_today: 'Next time X, do Y.',
  nodes: [
    { id: 'n1', kind: 'decision', situation: 'SIT-1 what now?', choices: [
      { text: 'weak one', feedback: 'fb weak', next: 'n2', quality: 'weak' }, { text: 'best one', feedback: 'fb best', next: 'n2', quality: 'best' } ] },
    { id: 'n2', kind: 'decision', situation: 'SIT-2 and then?', choices: [
      { text: 'weak two', feedback: 'fb weak', next: 'e1', quality: 'weak' }, { text: 'best two', feedback: 'fb best', next: 'e1', quality: 'best' } ] },
    { id: 'e1', kind: 'ending', situation: 'END done' } ] }

const BLUEPRINT = {
  objective: 'Apply a changeover check before locking a schedule.',
  sections: [
    { id: 's1', kind: 'hook', title: 'Why check changeover first?', purpose: 'State the task and payoff.', target_minutes: 0.3, source_refs: [PRIMARY] },
    { id: 's2', kind: 'chunk', title: 'What is changeover time?', purpose: 'Define it.', target_minutes: 0.8, source_refs: [PRIMARY] },
    { id: 's3', kind: 'chunk', title: 'How does order change it?', purpose: 'Show the effect.', target_minutes: 0.8, source_refs: [PRIMARY, SECOND] },
    { id: 's4', kind: 'chunk', title: 'When do you retest?', purpose: 'Confirm the saving.', target_minutes: 0.8, source_refs: ['not-a-source'] },
    { id: 's5', kind: 'apply', title: 'Apply today', purpose: 'One action.', target_minutes: 0.3 },
    { id: 's6', kind: 'recall', title: 'Day 2', purpose: 'Recall.', target_minutes: 0.5, recall_day: 2 },
    { id: 's7', kind: 'recall', title: 'Day 7', purpose: 'Recall.', target_minutes: 0.5, recall_day: 7 },
    { id: 's8', kind: 'recall', title: 'Day 21', purpose: 'Recall.', target_minutes: 0.5, recall_day: 21 },
  ],
}
const para = n => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')
const textBlocks = () => [
  { section_id: 's1', kind: 'hook', body: `HOOK-BODY ${para(25)}`, source_refs: [PRIMARY] },
  { section_id: 's2', kind: 'chunk', body: `CHUNK2-BODY ${para(110)}`, visual: 'VISUAL-2 a diagram of the matrix', alt_text: 'ALT VISUAL-2', source_refs: [PRIMARY, 'bogus'] },
  { section_id: 's3', kind: 'chunk', body: `CHUNK3-BODY ${para(110)}`, visual: 'VISUAL-3 an annotated screenshot', alt_text: 'ALT VISUAL-3', source_refs: [] },
  { section_id: 's4', kind: 'chunk', body: `CHUNK4-BODY ${para(110)}`, visual: 'VISUAL-4 diagram', alt_text: 'ALT VISUAL-4' },
  { section_id: 's5', kind: 'apply', body: 'Next time you build a schedule, list the changeover minutes first.' },
  { section_id: 's6', kind: 'recall', body: 'RECALL-2 What does changeover time measure?', answer: 'ANSWER-2 Idle minutes between products.', recall_day: 2 },
  { section_id: 's7', kind: 'recall', body: 'RECALL-7 Why group similar products?', answer: 'ANSWER-7 It cuts idle time.', recall_day: 7 },
  { section_id: 's8', kind: 'recall', body: 'RECALL-21 When do you retest a new order?', answer: 'ANSWER-21 Before you lock the plan.', recall_day: 21 },
]
const PLACEMENTS = [
  { after_section: 's2', artifact_type: 'flip-card-deck', note: 'NOTE-FLIP key facts after the definition.' },
  { after_section: 's3', artifact_type: 'knowledge-check', note: 'NOTE-KC check the idea just taught.' },
  { after_section: 's4', artifact_type: 'scenario-branching', note: 'NOTE-SCEN practice the decision.' },
]

let mode = 'ok'
let prompts = []
let systems = []
const mock = http.createServer((req, res) => {
  let raw = ''
  req.on('data', c => (raw += c))
  req.on('end', () => {
    const body = JSON.parse(raw)
    const user = body.messages[1].content
    prompts.push(user)
    systems.push(body.messages[0].content)
    let out
    if (/^Plan a lesson blueprint/.test(user)) {
      out = JSON.parse(JSON.stringify(BLUEPRINT))
      if (mode === 'bp_missing_day21') out.sections = out.sections.filter(s => s.recall_day !== 21)
      if (mode === 'bp_shuffled') out.sections = [out.sections[5], out.sections[0], out.sections[7], ...out.sections.slice(1, 5), out.sections[6]]
    } else if (/^Write the text of a lesson/.test(user)) {
      out = { blocks: textBlocks(), placements: PLACEMENTS }
      if (mode === 'text_missing_block') out.blocks = out.blocks.filter(b => b.section_id !== 's5')
      if (mode === 'text_no_retrieval') out.placements = [PLACEMENTS[0]]
      if (mode === 'text_chunk_no_visual') delete out.blocks[1].visual
      if (mode === 'alt_missing') delete out.blocks[1].alt_text
      if (mode === 'alt_decorative') { delete out.blocks[1].alt_text; out.blocks[1].decorative = true; out.blocks[1].decorative_reason = 'Mood image only.' }
      if (mode === 'alt_decorative_noreason') { delete out.blocks[1].alt_text; out.blocks[1].decorative = true }
      if (mode === 'alt_long') out.blocks[1].long_description = 'LONG-1 first part. Second part.'
      if (mode === 'text_recall_no_answer') delete out.blocks[5].answer
      const tabsP = { after_section: 's2', artifact_type: 'tabs', note: 'NOTE-TABS compare host, client, and server.' }
      if (mode === 'text_with_tabs') out.placements = [...PLACEMENTS, tabsP]
      if (mode === 'text_five_placements') out.placements = [...PLACEMENTS, tabsP, { after_section: 's1', artifact_type: 'flip-card-deck', note: 'dup' }]
      if (mode === 'text_tabs_only') out.placements = [tabsP]
    } else if (/^Write the text alternative/.test(user)) {
      const brief = (user.match(/═══ THE VISUAL[^\n]*\n([\s\S]*?)\n\n═══/) || [])[1] || ''
      out = { alt_text: `DRAFT-ALT ${brief.slice(0, 12)}`, long_description: /diagram|comparison/i.test(brief) ? 'DRAFT-LONG the parts and how they connect.' : '' }
    } else if (/^Write a tabs block/.test(user)) {
      // n tabs (or 3), 40-word bodies; echo any focus into the title so a test can see it arrive
      const n = Number((user.match(/Exactly (\d) tabs/) || [])[1]) || 3
      const f = user.match(/^Focus: (.*)$/m)
      out = {
        title: f ? `Tabs :: ${f[1]}` : 'Roles at a glance',
        tabs: Array.from({ length: n }, (_, i) => ({ label: `Tab${i + 1}`, body: `TABBODY${i + 1} ${para(39)}`, ...(i === 0 ? { visual: 'TAB-VISUAL a diagram', alt_text: 'TAB-ALT diagram' } : {}) })),
      }
    } else if (/^(?:Rewrite|Write) one (\w+) block/.test(user)) {
      const kind = user.match(/^(?:Rewrite|Write) one (\w+) block/)[1]
      const f = user.match(/^Focus: (.*)$/m)
      const tag = f ? ` :: ${f[1]}` : ''
      out = { body: `REGEN-${kind}-BODY${tag} ${para(20)}` }
      if (kind === 'chunk') { out.title = 'Regenerated title'; if (mode !== 'tb_no_visual') out.visual = 'REGEN-VISUAL a new diagram'; out.alt_text = 'REGEN-ALT' }
      if (kind === 'recall' && mode !== 'tb_no_answer') out.answer = 'REGEN-ANSWER short'
    } else if (/^Generate a flip card deck/.test(user) && mode === 'deck_no_alt') {
      const d = JSON.parse(JSON.stringify(DECK)); delete d.alt_text; out = d
    } else if (/^Generate a flip card deck/.test(user)) {
      // Echo any block-context focus into the cards, so a test can see it reached the model.
      const m = user.match(/^Focus: (.*)$/m)
      out = m ? { ...DECK, cards: DECK.cards.map(c => ({ ...c, front: `${c.front} :: ${m[1]}` })) } : DECK
    }
    else if (/^Generate a knowledge check/.test(user)) out = KC
    else if (/^Generate a branching scenario/.test(user)) out = SCEN
    else out = {}
    const content = mode === 'notjson' ? 'Here you go, no JSON.' : JSON.stringify(out)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content } }] }))
  })
})

const api = async (method, p, body) => {
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return r.json()
}
const L = `/projects/${P}/lessons`
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0)
const lastPrompt = () => prompts[prompts.length - 1] || ''
const lastSystem = () => systems[systems.length - 1] || ''
const artifactPath = (source, folder) => path.join(HOME, 'Byte', 'projects', P, 'sources', source, 'artifacts', folder)

async function newApprovedLesson(extra = {}) {
  mode = 'ok'
  const c = await api('POST', L, { topic: 'Check changeover', sources: [PRIMARY], ...extra })
  const id = c.data.lesson.id
  await api('POST', `${L}/${id}/blueprint/generate`)
  await api('PUT', `${L}/${id}/blueprint`, { approve: true })
  return id
}



// ── environment: mock model, backend, and (for browser suites) the Vite dev server ──
const children = []
const REPO = path.resolve(__dirname, '..', '..', '..')

async function assertPortFree(url, what) {
  let up = false
  try { await fetch(url); up = true } catch { /* nothing is listening, good */ }
  if (up) throw new Error(`${what} is already running (${url}). Stop \`npm run dev\` before running the accessibility suite.`)
}

async function startEnv({ ui }) {
  await assertPortFree('http://127.0.0.1:3001/api/health', 'The Byte backend')
  if (ui) await assertPortFree('http://localhost:5173/', 'The Byte frontend')
  await new Promise(r => mock.listen(4010, r))
  // A throwaway HOME, so the suite never touches the real ~/Byte folder.
  children.push(spawn('node', ['server.js'], { cwd: path.join(REPO, 'backend'), env: { ...process.env, HOME }, stdio: 'ignore', detached: true }))
  if (ui) children.push(spawn('npx', ['vite', '--port', '5173', '--strictPort'], { cwd: path.join(REPO, 'frontend'), env: process.env, stdio: 'ignore', detached: true }))
  await waitFor(API + '/health')
  if (ui) await waitFor(APP + '/')
}

async function stopEnv() {
  // Each child leads its own process group (npx starts Vite as a grandchild),
  // so kill the whole group, then wait for the ports to come free.
  for (const c of children) { try { process.kill(-c.pid, 'SIGTERM') } catch { /* already gone */ } }
  children.length = 0
  try { mock.close() } catch { /* already closed */ }
  for (let i = 0; i < 40; i++) {
    let busy = false
    for (const u of ['http://127.0.0.1:3001/api/health', 'http://localhost:5173/']) { try { await fetch(u); busy = true } catch { /* free */ } }
    if (!busy) break
    await sleep(250)
  }
  fs.rmSync(HOME, { recursive: true, force: true })
}

function findChromium() {
  if (process.env.BYTE_TEST_CHROMIUM) return process.env.BYTE_TEST_CHROMIUM
  return undefined   // playwright-core's own download (npm run test:a11y:setup)
}

async function launchBrowser() {
  try {
    return await chromium.launch({ executablePath: findChromium() })
  } catch (err) {
    throw new Error('Chromium is not installed for the test suite. Run: npm run test:a11y:setup\n' + err.message)
  }
}

function counts() { return { pass, fail } }
function finish() {
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
const setMode = m => { mode = m }
const getMode = () => mode

module.exports = {
  fs,
  os,
  path,
  http,
  HOME,
  API,
  MOCK,
  P,
  PRIMARY,
  SECOND,
  check,
  sleep,
  opt,
  DECK,
  KC,
  SCEN,
  BLUEPRINT,
  para,
  textBlocks,
  PLACEMENTS,
  prompts,
  systems,
  mock,
  api,
  L,
  sum,
  lastPrompt,
  lastSystem,
  artifactPath,
  newApprovedLesson,
  setMode, getMode, waitFor, os, fs, path, http, spawn,
  startEnv, stopEnv, launchBrowser, counts, finish, REPO,
}
