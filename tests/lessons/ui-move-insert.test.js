// Browser: moving blocks, inserting chunk/apply/recall, and progress protection
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
  await api('POST', `/projects/${P}/sources/${PRIMARY}/artifacts/generate`, { artifactType: 'scenario-branching' })
  const kcRef = (await api('GET', `/projects/${P}/artifacts?type=knowledge-check`)).data[0]
  const scRef = (await api('GET', `/projects/${P}/artifacts?type=scenario-branching`)).data[0]

  const browser = await env.launchBrowser()
  const page = await browser.newPage({ viewport: { width: 1200, height: 1500 } })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(m.text()) })
  const lessonOf = async id => (await api('GET', `${L}/${id}`)).data.lesson
  const orderOf = async id => (await lessonOf(id)).blocks.map(b => b.id)
  const domOrder = () => page.$$eval('.lesson-blocks > * .lesson-block, .lesson-blocks > .lesson-block', els => els.map(e => (e.className.match(/lesson-block-(\w+)/) || [, e.className.includes('artifact') ? 'artifact' : e.className.includes('tabs') ? 'tabs' : 'x'])[1]))

  try {
    const id = await draftViaApi({}, { withTabs: true })
    const kb = (await lessonOf(id)).blocks.find(x => x.artifact_type === 'knowledge-check')
    const sb = (await lessonOf(id)).blocks.find(x => x.artifact_type === 'scenario-branching')
    await api('POST', `${L}/${id}/blocks/${kb.id}/artifact`, { mode: 'existing', source: kcRef.source, artifact: kcRef.folder })
    await api('POST', `${L}/${id}/blocks/${sb.id}/artifact`, { mode: 'existing', source: scRef.source, artifact: scRef.folder })
    await page.goto(`${APP}/projects/${P}/lessons/${id}`)
    await page.waitForSelector('.lesson-block-hook')
    const kc = page.locator('.lesson-artifact:has-text("STEM-1")')
    const sc = page.locator('.lesson-artifact:has-text("SIT-1")')
    await kc.locator('.kc-option').first().click()
    await sc.locator('.scenario-choice').first().click()
    const kcProgress = async () => (await kc.locator('.kc-feedback').isVisible()) && (await kc.locator('.kc-option:disabled').count()) === 3
    const scProgress = async () => (await sc.locator('.scenario-feedback').isVisible()) && (await sc.locator('.scenario-choice:disabled').count()) === 2
    check('(setup) KC and scenario answered', await kcProgress() && await scProgress())
    const protectedOk = async () => (await kcProgress()) && (await scProgress())
    const moveBtn = (bid, dir) => page.locator(`[data-move="${bid}:${dir}"]`)

    console.log('Move controls')
    const L0 = await lessonOf(id)
    const hookId = L0.blocks[0].id
    check('the hook has no move buttons', (await moveBtn(hookId, 'up').count()) === 0 && (await moveBtn(hookId, 'down').count()) === 0)
    check('recall prompts have no move buttons', (await page.locator('.move-controls[aria-label*="recall"]').count()) === 0)
    const movable = L0.blocks.filter(b => b.kind !== 'hook' && b.kind !== 'recall')
    check('every other block has Move up and Move down', (await page.locator('[data-move]').count()) === movable.length * 2)
    check('the first block after the hook: Move up disabled', await moveBtn(L0.blocks[1].id, 'up').isDisabled() && !(await moveBtn(L0.blocks[1].id, 'down').isDisabled()))
    const lastMovable = movable[movable.length - 1]
    check('the last block before recall: Move down disabled', await moveBtn(lastMovable.id, 'down').isDisabled() && !(await moveBtn(lastMovable.id, 'up').isDisabled()))
    check('buttons name the block for screen readers', (await moveBtn(L0.blocks[1].id, 'down').getAttribute('aria-label')).startsWith('Move the'))

    const b1 = L0.blocks[1], b2 = L0.blocks[2]
    const t0 = await meterTotal(page)
    await moveBtn(b1.id, 'down').click()
    await page.waitForFunction(([a, b]) => { const els = [...document.querySelectorAll('[data-move]')].map(e => e.dataset.move.split(':')[0]); return els.indexOf(a) > els.indexOf(b) }, [b1.id, b2.id])
    const o1 = await orderOf(id)
    check('Move down swaps with the next block, saved', o1[1] === b2.id && o1[2] === b1.id, o1)
    check('time meter unchanged by a move', (await meterTotal(page)) === t0)
    check('KC and scenario progress survive a move of a neighbour', await protectedOk())

    console.log('Keyboard only')
    await moveBtn(b1.id, 'down').focus()
    await page.keyboard.press('Enter')
    await page.waitForFunction(bid => (document.activeElement && document.activeElement.dataset.move) === bid + ':down' && !document.activeElement.disabled || false, b1.id).catch(() => {})
    await sleep(700)
    let active = await page.evaluate(() => document.activeElement && document.activeElement.dataset.move)
    check('after Enter the focus stays on the same block\'s Move down button', active === `${b1.id}:down`, active)
    const o2 = await orderOf(id)
    check('Enter moved it down one more place', o2.indexOf(b1.id) === o1.indexOf(b1.id) + 1, o2)
    await page.keyboard.press('Space')
    await sleep(700)
    const o3 = await orderOf(id)
    check('Space works too', o3.indexOf(b1.id) === o2.indexOf(b1.id) + 1, o3)
    active = await page.evaluate(() => document.activeElement && document.activeElement.dataset.move)
    check('focus still on that button', active === `${b1.id}:down`, active)
    const note = await page.locator('[role=status]:has-text("Moved")').textContent()
    check('a screen-reader announcement says what moved and where', /^Moved .* down\. It is now block \d+ of \d+\.$/.test(note), note)
    // push it to the very end: focus must hop to Move up when Move down becomes disabled
    for (let i = 0; i < 12; i++) {
      if (await moveBtn(b1.id, 'down').isDisabled()) break
      await moveBtn(b1.id, 'down').focus()
      await page.keyboard.press('Enter')
      await sleep(500)
    }
    active = await page.evaluate(() => document.activeElement && document.activeElement.dataset.move)
    check('at the end Move down is disabled and focus moves to Move up (not lost)', await moveBtn(b1.id, 'down').isDisabled() && active === `${b1.id}:up`, active)
    check('it stopped above the recall prompts', (await lessonOf(id)).blocks.slice(-3).every(b => b.kind === 'recall'))
    check('KC and scenario progress survive many moves', await protectedOk())
    // move the KC itself
    await moveBtn(kb.id, 'up').focus()
    await page.keyboard.press('Enter')
    await sleep(700)
    await moveBtn(kb.id, 'down').focus()
    await page.keyboard.press('Enter')
    await sleep(700)
    check('moving the knowledge check ITSELF keeps its answer', await kcProgress())
    await moveBtn(sb.id, 'down').click()
    await sleep(700)
    check('moving the scenario ITSELF keeps its progress', await scProgress())

    console.log('Insert chunk, apply, recall')
    const insertAfterBlock = async bid => {
      const row = page.locator(`[data-move="${bid}:up"]`).locator('xpath=ancestor::*[contains(@class,"move-controls")]/following-sibling::*[1]')
      await row.locator('button:has-text("+ Insert here")').click()
      return row
    }
    let row = await insertAfterBlock(b1.id)
    const menu = await row.locator('button').allTextContents()
    check('Insert menu offers Chunk, Apply block and Recall prompt', ['Chunk', 'Apply block', 'Recall prompt'].every(x => menu.includes(x)), menu)
    await row.locator('button:has-text("Chunk")').click()
    check('each offers Write it myself and Generate', await row.locator('button:has-text("Write it myself")').isVisible() && await row.locator('button:has-text("Generate...")').isVisible())
    await row.locator('button:has-text("Write it myself")').click()
    const flow = page.locator('.insert-flow')
    check('write form shows title, text, visual note', await flow.getByLabel('Title').isVisible() && await flow.getByLabel('Text').isVisible() && await flow.getByLabel(/Visual note/).isVisible())
    await flow.getByLabel('Title').fill('Inserted by me')
    await flow.getByLabel('Text').fill('INSERTED-TEXT body words.')
    await flow.getByLabel(/Visual note/).fill('INSERTED-VISUAL')
    const mBefore = await meterTotal(page)
    await flow.locator('button:has-text("Insert")').last().click()
    await page.waitForSelector('.lesson-block-chunk:has-text("INSERTED-TEXT")')
    const L1 = await lessonOf(id)
    const ni = L1.blocks.findIndex(b => b.title === 'Inserted by me')
    check('the chunk is inserted right after the chosen block, flagged edited', ni === L1.blocks.findIndex(b => b.id === b1.id) + 1 && L1.blocks[ni].edited === true)
    check('time meter rose', (await meterTotal(page)) > mBefore)
    check('progress survives a text insert', await protectedOk())

    row = await insertAfterBlock(b2.id)
    await row.locator('button:has-text("Apply block")').click()
    await row.locator('button:has-text("Generate...")').click()
    await page.locator('.insert-flow .context-panel input[type=text]').first().fill('apply focus')
    await page.locator('.insert-flow .context-panel button:has-text("Generate")').click()
    await page.waitForSelector('.lesson-block-apply:has-text("REGEN-apply :: apply focus")')
    check('generated apply block appears; "Generated with" line shows', await page.locator('.lesson-block-apply:has-text("REGEN-apply") >> text=Generated with: focus "apply focus"').isVisible())
    check('progress survives a generated insert', await protectedOk())

    console.log('Recall insert')
    const recallDays = async () => (await lessonOf(id)).blocks.filter(b => b.kind === 'recall').map(b => b.recall_day)
    row = await insertAfterBlock(b2.id)
    await row.locator('button:has-text("Recall prompt")').click()
    await row.locator('button:has-text("Write it myself")').click()
    check('with all three days used there is a message, no form', await page.locator('.insert-flow').locator('text=All three recall days').isVisible() && !(await page.locator('.insert-flow textarea').count()))
    await page.locator('.insert-flow button:has-text("Close")').click()
    const d7 = (await lessonOf(id)).blocks.find(b => b.recall_day === 7)
    await page.locator('.lesson-block-recall:has-text("RECALL-7")').locator('button:has-text("Remove")').click()
    await page.locator('.lesson-block-recall:has-text("RECALL-7") button:has-text("Yes, remove")').click()
    await page.waitForFunction(() => !document.body.textContent.includes('RECALL-7'))
    row = await insertAfterBlock(b2.id)
    await row.locator('button:has-text("Recall prompt")').click()
    await row.locator('button:has-text("Write it myself")').click()
    const flow2 = page.locator('.insert-flow')
    check('only the free day is offered', (await flow2.locator('select option').allTextContents()).join() === 'Day 7')
    check('the form says recall always goes at the end', await flow2.locator('text=always go at the end').isVisible())
    const ta = flow2.locator('textarea')
    await ta.nth(0).fill('NEW-RECALL-Q7?')
    await ta.nth(1).fill('NEW-RECALL-A7')
    await flow2.locator('button:has-text("Insert")').last().click()
    await page.waitForSelector('.lesson-block-recall:has-text("NEW-RECALL-Q7")')
    check('the recall prompt lands in the tail, in day order', JSON.stringify(await recallDays()) === '[2,7,21]' && (await lessonOf(id)).blocks.slice(-3).every(b => b.kind === 'recall'))
    check('progress survives a recall insert', await protectedOk())

    console.log('Visual note text areas grow')
    const chunk = page.locator('.lesson-block-chunk').first()
    await chunk.locator('button:has-text("Edit")').click()
    const vis = chunk.getByLabel(/Visual note/)
    check('the visual note is a multi-line text area', (await vis.evaluate(e => e.tagName)) === 'TEXTAREA')
    const h0 = await vis.evaluate(e => e.clientHeight)
    await vis.fill(Array.from({ length: 30 }, (_, i) => `Line ${i} of a long visual description.`).join('\n'))
    const h1 = await vis.evaluate(e => e.clientHeight)
    check('it grows with its content (no inner scrollbar)', h1 > h0 * 3 && (await vis.evaluate(e => e.scrollHeight - e.clientHeight)) <= 4, [h0, h1])
    await vis.fill('short')
    check('...and shrinks back', (await vis.evaluate(e => e.clientHeight)) < h1)
    await chunk.locator('button:has-text("Cancel")').click()
    const tabsP = page.locator('.lesson-proposal:has-text("Tabs"), .lesson-tabs-block').first()
    if (await tabsP.locator('button:has-text("Write it myself")').count()) await tabsP.locator('button:has-text("Write it myself")').click()
    else await tabsP.locator('button:has-text("Edit")').click()
    const tv = tabsP.getByLabel('Tab 1 visual note')
    check('the tab visual note is a text area too', (await tv.evaluate(e => e.tagName)) === 'TEXTAREA')
    const th0 = await tv.evaluate(e => e.clientHeight)
    await tv.fill(Array.from({ length: 20 }, (_, i) => `Tab line ${i}.`).join('\n'))
    check('...and grows', (await tv.evaluate(e => e.clientHeight)) > th0 * 3)

    await page.screenshot({ path: path.join(SHOT, 'd1-c3.png') })
    check('no page errors', errors.length === 0, errors)
  } finally {
    await browser.close(); await env.stopEnv(mock)
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
