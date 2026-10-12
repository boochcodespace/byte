// Shared setup for the browser accessibility suites: a mock AI model, fixtures,
// the backend and Vite dev server on a throwaway HOME, and small helpers.
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { spawn } = require('child_process')

const env = require('../../support/env')
const HOME = env.HOME
const SHOT = env.SHOT
const P = 'getting-started'
const PRIMARY = 'active-listening'
const SECOND = 'second-source'
const API = 'http://127.0.0.1:3001/api'
const APP = 'http://localhost:5173'
const MOCK = 'http://127.0.0.1:4010'

let pass = 0, fail = 0
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS', name) } else { fail++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : '') }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(url) {
  for (let i = 0; i < 60; i++) { try { await fetch(url); return } catch { await sleep(250) } }
  throw new Error('timeout ' + url)
}

const opt = (text, correct, rationale) => ({ text, correct, rationale })
const DECK = { learning_objective: 'DECK-OBJ', estimated_minutes: 3, visual_anchor_description: 'd', alt_text: 'DECK-ALT',
  cards: [1, 2, 3, 4].map(i => ({ type: i === 1 ? 'hook' : i === 4 ? 'apply' : 'content', front: `front ${i}`, back: `back ${i}` })), spaced_repetition_notes: 'n' }
const KC = { learning_objective: 'KC-OBJ', estimated_minutes: 3, setup: 'You will check things.', apply_today: 'Next time X happens, do Y.',
  items: [1, 2, 3].map(i => ({ id: `q${i}`, stem: `STEM-${i} what do you do first?`,
    options: [opt(`KEY-${i} one`, true, `R-KEY-${i}`), opt(`D1-${i} two`, false, `R-D1-${i}`), opt(`D2-${i} three`, false, `R-D2-${i}`)] })) }
const SCEN = { learning_objective: 'SCEN-OBJ', estimated_minutes: 3, setup: 'You will decide.', start_node: 'n1', apply_today: 'Next time X, do Y.',
  nodes: [
    { id: 'n1', kind: 'decision', situation: 'SIT-1 what now?', choices: [
      { text: 'weak one', feedback: 'fb weak', next: 'n2', quality: 'weak' }, { text: 'best one', feedback: 'fb best', next: 'n2', quality: 'best' } ] },
    { id: 'n2', kind: 'decision', situation: 'SIT-2 and then?', choices: [
      { text: 'weak two', feedback: 'fb weak 2', next: 'e1', quality: 'weak' }, { text: 'best two', feedback: 'fb best 2', next: 'e1', quality: 'best' } ] },
    { id: 'e1', kind: 'ending', situation: 'END done' } ] }
const BLUEPRINT = {
  objective: 'Apply a changeover check before locking a schedule.',
  sections: [
    { id: 's1', kind: 'hook', title: 'Why check changeover first?', purpose: 'State the task and payoff.', target_minutes: 0.3, source_refs: [PRIMARY] },
    { id: 's2', kind: 'chunk', title: 'What is changeover time?', purpose: 'Define it.', target_minutes: 0.8, source_refs: [PRIMARY] },
    { id: 's3', kind: 'chunk', title: 'How does order change it?', purpose: 'Show the effect.', target_minutes: 0.8, source_refs: [PRIMARY] },
    { id: 's4', kind: 'chunk', title: 'When do you retest?', purpose: 'Confirm the saving.', target_minutes: 0.8, source_refs: [PRIMARY] },
    { id: 's5', kind: 'apply', title: 'Apply today', purpose: 'One action.', target_minutes: 0.3 },
    { id: 's6', kind: 'recall', title: 'Day 2', purpose: 'Recall.', target_minutes: 0.5, recall_day: 2 },
    { id: 's7', kind: 'recall', title: 'Day 7', purpose: 'Recall.', target_minutes: 0.5, recall_day: 7 },
    { id: 's8', kind: 'recall', title: 'Day 21', purpose: 'Recall.', target_minutes: 0.5, recall_day: 21 } ] }
const para = n => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')
const TEXT = {
  blocks: [
    { section_id: 's1', kind: 'hook', body: `HOOK-BODY ${para(25)}`, source_refs: [PRIMARY] },
    { section_id: 's2', kind: 'chunk', body: `CHUNK2-BODY ${para(110)}`, visual: 'VISUAL-2 a diagram of the matrix', alt_text: 'ALT VISUAL-2' },
    { section_id: 's3', kind: 'chunk', body: `CHUNK3-BODY ${para(110)}`, visual: 'VISUAL-3 annotated screenshot', alt_text: 'ALT VISUAL-3' },
    { section_id: 's4', kind: 'chunk', body: `CHUNK4-BODY ${para(110)}`, visual: 'VISUAL-4 diagram', alt_text: 'ALT VISUAL-4' },
    { section_id: 's5', kind: 'apply', body: 'APPLY-BODY Next time you build a schedule, list the changeover minutes first.' },
    { section_id: 's6', kind: 'recall', body: 'RECALL-2 What does changeover time measure?', answer: 'ANSWER-2 Idle minutes between products.', recall_day: 2 },
    { section_id: 's7', kind: 'recall', body: 'RECALL-7 Why group similar products?', answer: 'ANSWER-7 It cuts idle time.', recall_day: 7 },
    { section_id: 's8', kind: 'recall', body: 'RECALL-21 When do you retest?', answer: 'ANSWER-21 Before you lock the plan.', recall_day: 21 } ],
  placements: [
    { after_section: 's2', artifact_type: 'flip-card-deck', note: 'NOTE-FLIP key facts after the definition.' },
    { after_section: 's3', artifact_type: 'knowledge-check', note: 'NOTE-KC check the idea just taught.' },
    { after_section: 's4', artifact_type: 'scenario-branching', note: 'NOTE-SCEN practice the decision.' } ] }

let mode = 'ok'
const mock = http.createServer((req, res) => {
  let raw = ''
  req.on('data', c => (raw += c))
  req.on('end', () => {
    const user = JSON.parse(raw).messages[1].content
    let out = {}
    let delay = 0
    if (/^Plan a lesson blueprint/.test(user)) out = BLUEPRINT
    else if (/^Write the text of a lesson/.test(user)) {
      out = mode === 'text_with_tabs' ? { ...TEXT, placements: [...TEXT.placements, { after_section: 's2', artifact_type: 'tabs', note: 'NOTE-TABS compare host, client, and server.' }] } : TEXT
      delay = 600
    }
    else if (/^Write a tabs block/.test(user)) {
      const n = Number((user.match(/Exactly (\d) tabs/) || [])[1]) || 3
      const f = user.match(/^Focus: (.*)$/m)
      out = { title: f ? `Tabs :: ${f[1]}` : 'Roles at a glance', tabs: Array.from({ length: n }, (_, i) => ({ label: `Tab${i + 1}`, body: `TABBODY${i + 1} ${para(39)}`, ...(i === 0 ? { visual: 'TAB-VISUAL a diagram', alt_text: 'TAB-ALT diagram' } : {}) })) }
      delay = 400
    }
    else if (/^(?:Rewrite|Write) one (\w+) block/.test(user)) {
      const kind = user.match(/^(?:Rewrite|Write) one (\w+) block/)[1]
      const f = user.match(/^Focus: (.*)$/m)
      out = { body: `REGEN-${kind} ${f ? ':: ' + f[1] + ' ' : ''}${para(20)}` }
      if (kind === 'chunk') { out.title = 'Regenerated title'; out.visual = 'REGEN-VISUAL'; out.alt_text = 'REGEN-ALT' }
      if (kind === 'recall') out.answer = 'REGEN-ANSWER'
      delay = 500
    }
    else if (/^Write the text alternative/.test(user)) {
      const brief = (user.match(/═══ THE VISUAL[^\n]*\n([\s\S]*?)\n\n═══/) || [])[1] || ''
      out = { alt_text: `DRAFT-ALT ${brief.slice(0, 12)}`, long_description: /diagram|comparison/i.test(brief) ? 'DRAFT-LONG the parts connect.' : '' }
      delay = 400
    }
    else if (/^Generate a flip card deck/.test(user)) {
      const m = user.match(/^Focus: (.*)$/m)
      out = m ? { ...DECK, cards: DECK.cards.map(c => ({ ...c, front: `${c.front} :: ${m[1]}` })) } : DECK
      delay = 600
    }
    else if (/^Generate a knowledge check/.test(user)) { out = mode === 'kc_distinct' ? { ...KC, learning_objective: 'KC-NEW-OBJ', items: KC.items.map(it => ({ ...it, stem: it.stem + ' (new)' })) } : KC; delay = 600 }
    else if (/^Generate a branching scenario/.test(user)) { out = SCEN; delay = 600 }
    const content = mode === 'notjson' ? 'Sorry, no JSON here.' : JSON.stringify(out)
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content } }] }))
    }, delay)
  })
})

const api = async (method, p, body) => {
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return r.json()
}
const L = `/projects/${P}/lessons`
const lessonFile = id => path.join(HOME, 'Byte', 'projects', P, 'lessons', id, 'lesson.json')
const meterTotal = page => page.$eval('.time-meter-label strong', e => Number(e.textContent))
const proposal = (page, label) => page.locator(`.lesson-proposal:has-text("Suggested: ${label}")`)

async function draftViaApi(extra = {}, { withTabs = false } = {}) {
  mode = 'ok'
  const c = await api('POST', L, { topic: 'API lesson', sources: [PRIMARY], ...extra })
  const id = c.data.lesson.id
  await api('POST', `${L}/${id}/blueprint/generate`)
  await api('PUT', `${L}/${id}/blueprint`, { approve: true })
  if (withTabs) mode = 'text_with_tabs'
  await api('POST', `${L}/${id}/text/generate`)
  mode = 'ok'
  return id
}





// ── environment (shared with every suite: tests/support/env.js) ──
const REPO = env.REPO
const startEnv = ({ ui }) => env.startEnv({ ui, mock })
const stopEnv = () => env.stopEnv(mock)
const launchBrowser = () => env.launchBrowser()

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
  SHOT,
  P,
  PRIMARY,
  SECOND,
  API,
  APP,
  MOCK,
  check,
  sleep,
  waitFor,
  opt,
  DECK,
  KC,
  SCEN,
  BLUEPRINT,
  para,
  TEXT,
  mock,
  api,
  L,
  lessonFile,
  meterTotal,
  proposal,
  draftViaApi,
  setMode, getMode, SHOT, os, fs, path, http, spawn,
  startEnv, stopEnv, launchBrowser, counts, finish, REPO,
}
