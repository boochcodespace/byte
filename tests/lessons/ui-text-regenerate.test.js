// Browser: regenerating lesson text blocks with context
// Run by `npm run test:all`. Uses a mock AI model and a throwaway HOME.
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const env = require('../support/env')
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

// ── fixtures (same shapes the API test uses) ───────────────────────
const opt = (text, correct, rationale) => ({ text, correct, rationale })
const DECK = { learning_objective: 'DECK-OBJ', estimated_minutes: 3, visual_anchor_description: 'd', alt_text: 'DECK-ALT',
  cards: [1, 2, 3, 4].map(i => ({ type: i === 1 ? 'hook' : i === 4 ? 'apply' : 'content', front: `front ${i}`, back: `back ${i}` })), spaced_repetition_notes: 'n' }
const KC = { learning_objective: 'KC-OBJ', estimated_minutes: 3, setup: 'You will check things.', apply_today: 'Next time X happens, do Y.',
  items: [1, 2, 3].map(i => ({ id: `q${i}`, stem: `STEM-${i} what do you do first?`,
    options: [opt(`KEY-${i} one`, true, `R-KEY-${i}`), opt(`D1-${i} two`, false, `R-D1-${i}`), opt(`D2-${i} three`, false, `R-D2-${i}`)] })) }
const SCEN = { learning_objective: 'SCEN-OBJ', estimated_minutes: 3, setup: 'You will decide.', start_node: 'n1', apply_today: 'Next time X, do Y.',
  nodes: [
    { id: 'n1', kind: 'decision', situation: 'SIT-1 what now?', choices: [
      { text: 'weak one', feedback: 'fb weak', next: 'e1', quality: 'weak' }, { text: 'best one', feedback: 'fb best', next: 'e1', quality: 'best' } ] },
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
    else if (/^Generate a flip card deck/.test(user)) {
      const m = user.match(/^Focus: (.*)$/m)
      out = m ? { ...DECK, cards: DECK.cards.map(c => ({ ...c, front: `${c.front} :: ${m[1]}` })) } : DECK
      delay = 600
    }
    else if (/^Generate a knowledge check/.test(user)) { out = KC; delay = 600 }
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

async function main() {
  await env.startEnv({ ui: true, mock })
  await api('GET', '/projects')
  await api('POST', '/settings', { provider: 'local', model: 'm', baseUrl: `${MOCK}/v1` })
  await api('POST', `/projects/${P}/sources/${PRIMARY}/artifacts/generate`, { artifactType: 'knowledge-check' })
  const kcRef = (await api('GET', `/projects/${P}/artifacts?type=knowledge-check`)).data[0]

  const browser = await env.launchBrowser()
  const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(m.text()) })
  const lessonOf = async id => (await api('GET', `${L}/${id}`)).data.lesson

  try {
    const id = await draftViaApi({}, { withTabs: true })
    const kb = (await lessonOf(id)).blocks.find(x => x.artifact_type === 'knowledge-check')
    await api('POST', `${L}/${id}/blocks/${kb.id}/artifact`, { mode: 'existing', source: kcRef.source, artifact: kcRef.folder })
    await page.goto(`${APP}/projects/${P}/lessons/${id}`)
    await page.waitForSelector('.lesson-block-hook')
    const chunk = page.locator('.lesson-block-chunk').first()
    const kc = page.locator('.lesson-artifact:has-text("STEM-1")')
    await kc.locator('.kc-option').first().click()
    const kcProgress = async () => (await kc.locator('.kc-feedback').isVisible()) && (await kc.locator('.kc-option:disabled').count()) === 3

    console.log('Regenerate with the context panel')
    check('every text block offers Regenerate', (await page.locator('.lesson-block-hook, .lesson-block-chunk, .lesson-block-apply, .lesson-block-recall').locator('button:has-text("Regenerate")').count()) === 8)
    await chunk.locator('button:has-text("Regenerate")').click()
    const panel = chunk.locator('.context-panel')
    check('panel opens with Focus, Source section, Experience, Notes', await panel.locator('label:has-text("Focus")').isVisible() && await panel.locator('label:has-text("Source section")').isVisible() && await panel.locator('label:has-text("Experience level")').isVisible() && await panel.locator('label:has-text("Notes")').isVisible())
    check('no count field for text blocks', !(await panel.locator('label:has-text("Number of")').count()))
    check('panel starts empty', (await panel.locator('input[type=text]').first().inputValue()) === '')
    await panel.locator('input[type=text]').first().fill('host and client roles')
    await panel.locator('select').last().selectOption('Expert').catch(() => {})
    await panel.locator('textarea').fill('use the roles section')
    const t0 = await meterTotal(page)
    await panel.locator('button:has-text("Regenerate")').click()
    check('spinner shows while working', await chunk.locator('.loading-state, [class*=loading]').first().isVisible().catch(() => false))
    check('other blocks are locked meanwhile', await page.locator('.lesson-block-hook button:has-text("Edit")').isDisabled())
    await page.waitForSelector('.lesson-block-chunk:has-text("Regenerated title")')
    check('block replaced with the new title and text', await chunk.locator('h2:has-text("Regenerated title")').isVisible() && await chunk.locator('text=:: host and client roles').isVisible())
    check('"Generated with" line shows the context', await chunk.locator('text=Generated with: focus "host and client roles"').isVisible())
    check('not flagged as edited', !(await chunk.locator('.lesson-badge').count()))
    check('time meter recomputed (110 words became 20)', (await meterTotal(page)) < t0, [t0, await meterTotal(page)])
    check('KC progress survives a text regenerate', await kcProgress())

    await chunk.locator('button:has-text("Regenerate")').click()
    check('panel reopens with the stored context', (await chunk.locator('.context-panel input[type=text]').first().inputValue()) === 'host and client roles' && (await chunk.locator('.context-panel textarea').inputValue()) === 'use the roles section')
    await chunk.locator('.context-panel button:has-text("Cancel")').click()
    check('Cancel closes it and changes nothing', !(await chunk.locator('.context-panel').count()) && await chunk.locator('h2:has-text("Regenerated title")').isVisible())

    console.log('Over hand edits')
    await chunk.locator('button:has-text("Edit")').click()
    await chunk.locator('textarea').first().fill('MY HAND EDIT')
    await chunk.locator('button:has-text("Save")').click()
    await page.waitForSelector('.lesson-block-chunk:has-text("MY HAND EDIT")')
    await chunk.locator('button:has-text("Regenerate")').click()
    await chunk.locator('.context-panel button:has-text("Regenerate")').click()
    check('first click warns that edits are replaced', await chunk.locator('.context-panel [role=alert]').isVisible() && await chunk.locator('.context-panel button:has-text("Yes, replace my edits")').isVisible())
    check('nothing replaced yet', await chunk.locator('text=MY HAND EDIT').isVisible())
    await chunk.locator('.context-panel button:has-text("Back")').click()
    check('Back returns to the form, edit intact', !(await chunk.locator('.context-panel [role=alert]').count()) && await chunk.locator('text=MY HAND EDIT').isVisible())

    console.log('A failed regenerate changes nothing')
    mode = 'notjson'
    await chunk.locator('.context-panel button:has-text("Regenerate")').click()
    await chunk.locator('.context-panel button:has-text("Yes, replace my edits")').click()
    await page.waitForSelector('.error-state')
    check('plain-language error with Retry', /Generation failed to produce valid output/.test(await page.textContent('.error-state')) && await page.isVisible('.error-state >> text=Retry'))
    check('the hand edit is still there and still flagged', await chunk.locator('text=MY HAND EDIT').isVisible() && await chunk.locator('.lesson-badge').isVisible())
    mode = 'ok'
    await page.click('.error-state >> text=Retry')
    await page.waitForFunction(() => !document.body.textContent.includes('MY HAND EDIT'))
    check('Retry works and replaces the edit', !(await chunk.locator('.lesson-badge').count()) && !(await page.locator('text=MY HAND EDIT').count()))

    console.log('Hook and recall')
    const hook = page.locator('.lesson-block-hook')
    await hook.locator('button:has-text("Regenerate")').click()
    await hook.locator('.context-panel input[type=text]').first().fill('the payoff')
    await hook.locator('.context-panel button:has-text("Regenerate")').click()
    await page.waitForSelector('.lesson-block-hook:has-text("REGEN-hook")')
    check('hook regenerated with focus', await hook.locator('text=:: the payoff').isVisible())
    const rc = page.locator('.lesson-block-recall').nth(1)
    await rc.locator('button:has-text("Regenerate")').click()
    await rc.locator('.context-panel button:has-text("Regenerate")').click()
    await page.waitForSelector('.lesson-block-recall:has-text("REGEN-recall")')
    await page.locator('.lesson-block-recall:has-text("REGEN-recall") button:has-text("Show answer")').click()
    check('recall regenerated with new answer; day label kept', await page.locator('text=REGEN-ANSWER').isVisible() && await page.locator('.lesson-block-recall:has-text("REGEN-recall") .lesson-label:has-text("Day 7")').isVisible())

    console.log('Fix 1: no limit on visual notes')
    const LONG = 'V'.repeat(1500)
    await chunk.locator('button:has-text("Edit")').click()
    check('chunk visual field has no maxlength', (await chunk.getByLabel(/Visual note/).getAttribute('maxlength')) === null)
    await chunk.getByLabel(/Visual note/).fill(LONG)
    await chunk.locator('button:has-text("Save")').click()
    await page.waitForSelector('.lesson-block-chunk >> text=VVVVVVVVVV')
    check('a 1,500-character visual note saves with no error', !(await page.locator('.error-state').count()) && (await lessonOf(id)).blocks.find(b => b.kind === 'chunk').visual.length === 1500)
    const tabsBlock = page.locator('.lesson-proposal:has-text("Tabs")').first()
    await tabsBlock.locator('button:has-text("Write it myself")').click()
    const ed = tabsBlock.locator('.tabs-editor')
    check('tab visual field has no maxlength', (await ed.getByLabel('Tab 1 visual note').getAttribute('maxlength')) === null)
    await ed.locator('input[type=text]').nth(1).fill('One')
    await ed.locator('textarea').nth(0).fill('First.')
    await ed.getByLabel('Tab 1 visual note').fill(LONG)
    await ed.getByLabel('Tab 2 label').fill('Two')
    await ed.getByLabel('Tab 2 text').fill('Second.')
    await ed.locator('button[type=submit]').click()
    await page.waitForSelector('.lesson-tabs')
    check('a long tab visual note saves with no error', !(await page.locator('.error-state').count()) && (await lessonOf(id)).blocks.find(b => b.kind === 'tabs').tabs[0].visual.length === 1500)

    await page.screenshot({ path: path.join(SHOT, 'd1-c2.png'), fullPage: false })
    check('no page errors', errors.length === 0, errors)
  } finally {
    await browser.close(); await env.stopEnv(mock)
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
