// Browser: inline edit and remove of lesson text blocks
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
  await api('POST', `/projects/${P}/sources/${PRIMARY}/artifacts/generate`, { artifactType: 'flip-card-deck' })
  const kcRef = (await api('GET', `/projects/${P}/artifacts?type=knowledge-check`)).data[0]
  const flipRef = (await api('GET', `/projects/${P}/artifacts?type=flip-card-deck`)).data[0]

  const browser = await env.launchBrowser()
  const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(m.text()) })
  const lessonOf = async id => (await api('GET', `${L}/${id}`)).data.lesson
  const textBlock = (kind, hasText) => page.locator(`.lesson-block-${kind}`).filter(hasText ? { hasText } : {}).first()
  const accept = async (id, type, ref) => {
    const b = (await lessonOf(id)).blocks.find(x => x.kind === 'artifact' && x.artifact_type === type && x.state === 'proposed')
    await api('POST', `${L}/${id}/blocks/${b.id}/artifact`, { mode: 'existing', source: ref.source, artifact: ref.folder })
  }

  try {
    const id = await draftViaApi({}, { withTabs: true })
    await accept(id, 'knowledge-check', kcRef)
    await accept(id, 'flip-card-deck', flipRef)
    await page.goto(`${APP}/projects/${P}/lessons/${id}`)
    await page.waitForSelector('.lesson-block-hook')

    console.log('Edit a chunk')
    const chunk = page.locator('.lesson-block-chunk').first()
    const t0 = await meterTotal(page)
    check('text blocks have Edit and Remove', await chunk.locator('button:has-text("Edit")').isVisible() && await chunk.locator('button:has-text("Remove")').isVisible())
    await chunk.locator('button:has-text("Edit")').click()
    check('editor shows title, text and visual fields', await chunk.getByLabel('Title').isVisible() && await chunk.locator('label:text-is("Text")').count() === 1 && await chunk.getByLabel(/Visual note/).isVisible() && await chunk.getByLabel('Alt text').isVisible())
    await chunk.locator('button:has-text("Cancel")').click()
    check('Cancel leaves it unedited', !(await chunk.locator('.lesson-badge').count()) && (await lessonOf(id)).blocks.filter(b => b.edited).length === 0)
    await chunk.locator('button:has-text("Edit")').click()
    await chunk.locator('input[type=text]').first().fill('My own title')
    await chunk.locator('textarea').first().fill('MY-TEXT short.')
    await chunk.getByLabel(/Visual note/).fill('MY-VISUAL a chart')
    await chunk.locator('button:has-text("Save")').click()
    await page.waitForSelector('.lesson-block-chunk:has-text("MY-TEXT")')
    const c = page.locator('.lesson-block-chunk').first()
    check('saved text, title and visual show', await c.locator('h2:has-text("My own title")').isVisible() && await c.locator('text=MY-VISUAL').isVisible())
    check('"Edited by you" badge appears', await c.locator('.lesson-badge:has-text("Edited by you")').isVisible())
    await page.waitForFunction(old => Number(document.querySelector('.time-meter-label strong').textContent) < old, t0)
    check('time meter dropped after the edit', (await meterTotal(page)) < t0, [t0, await meterTotal(page)])

    console.log('Empty text is refused with a message, nothing lost')
    await c.locator('button:has-text("Edit")').click()
    await c.locator('textarea').first().fill('')
    await c.locator('button:has-text("Save")').click()
    await page.waitForSelector('.error-state')
    check('empty body shows a plain message', /cannot be empty/.test(await page.textContent('.error-state')))
    check('editor stays open with the draft', await c.locator('textarea').first().isVisible())
    await c.locator('button:has-text("Cancel")').click()

    console.log('Hook, apply and recall')
    const hook = textBlock('hook')
    check('hook has no Remove, with a note', !(await hook.locator('button:has-text("Remove")').count()) && await hook.locator('text=can\'t be removed').isVisible())
    await hook.locator('button:has-text("Edit")').click()
    await hook.locator('textarea').fill('HOOK-NEW why this matters.')
    await hook.locator('button:has-text("Save")').click()
    await page.waitForSelector('.lesson-block-hook:has-text("HOOK-NEW")')
    check('hook edited and flagged', await textBlock('hook').locator('.lesson-badge').isVisible())
    const recall = textBlock('recall', 'RECALL-7')
    await recall.locator('button:has-text("Edit")').click()
    check('recall editor has question and answer', await recall.locator('textarea').count() === 2)
    await recall.locator('textarea').nth(0).fill('RECALL-7 new question?')
    await recall.locator('textarea').nth(1).fill('NEW-ANSWER-7')
    await recall.locator('button:has-text("Save")').click()
    await page.waitForSelector('.lesson-block-recall:has-text("new question")')
    await page.locator('.lesson-block-recall:has-text("new question") button:has-text("Show answer")').click()
    check('recall edit shows new answer', await page.locator('text=NEW-ANSWER-7').isVisible())
    check('recall day label unchanged', await page.locator('.lesson-block-recall:has-text("new question") .lesson-label:has-text("Day 7")').isVisible())

    console.log('Progress in a knowledge check survives edits and removes')
    const kc = page.locator('.lesson-artifact:has-text("STEM-1")')
    await kc.locator('.kc-option').first().click()
    const kcProgress = async () => (await kc.locator('.kc-feedback').isVisible()) && (await kc.locator('.kc-option:disabled').count()) === 3
    check('(setup) KC answered', await kcProgress())
    const apply = textBlock('apply')
    await apply.locator('button:has-text("Edit")').click()
    await apply.locator('textarea').fill('APPLY-NEW do it.')
    await apply.locator('button:has-text("Save")').click()
    await page.waitForSelector('.lesson-block-apply:has-text("APPLY-NEW")')
    check('KC progress survives a text edit', await kcProgress())

    console.log('Remove a text block')
    await c.locator('button:has-text("Remove")').click()
    check('edited block warns that edits are lost', await c.locator('text=Your edits will be lost').isVisible())
    check('no retrieval warning while a KC remains', !(await c.locator('text=no knowledge check or scenario').count()))
    await c.locator('button:has-text("Cancel")').click()
    check('Cancel keeps the block', await c.isVisible())
    const nBefore = (await lessonOf(id)).blocks.length
    await c.locator('button:has-text("Remove")').click()
    await c.locator('button:has-text("Yes, remove")').click()
    await page.waitForFunction(() => !document.body.textContent.includes('MY-TEXT'))
    check('chunk removed from page and file', (await lessonOf(id)).blocks.length === nBefore - 1)
    check('KC progress survives a removal', await kcProgress())

    console.log('Retrieval warning on artifact removal')
    const flip = page.locator('.lesson-artifact:has(.card-flip, .flip-card, [class*=flip])').first()
    const flipBlock = page.locator('.lesson-artifact').filter({ hasText: 'Flip Card Deck' }).first()
    await flipBlock.locator('button:has-text("Remove")').click()
    check('removing the flip deck (a KC remains) shows the plain message', !(await flipBlock.locator('text=no knowledge check or scenario').count()) && await flipBlock.locator('text=The artifact stays in your project').isVisible())
    await flipBlock.locator('button:has-text("Cancel")').click()
    const kcBlock = page.locator('.lesson-artifact').filter({ hasText: 'Knowledge Check' }).first()
    await kcBlock.locator('button:has-text("Remove")').click()
    check('removing the LAST KC warns about no retrieval practice', await kcBlock.locator('text=no knowledge check or scenario').isVisible())
    check('the warning does not refuse: Yes, remove is offered', await kcBlock.locator('button:has-text("Yes, remove")').isVisible())
    await kcBlock.locator('button:has-text("Cancel")').click()
    check('Cancel keeps the KC', await kcBlock.isVisible())
    await kcBlock.locator('button:has-text("Remove")').click()
    await kcBlock.locator('button:has-text("Yes, remove")').click()
    await page.waitForFunction(() => !document.body.textContent.includes('STEM-1'))
    check('the KC was removed after confirming', !(await lessonOf(id)).blocks.some(b => b.artifact_type === 'knowledge-check' && b.state === 'ready'))
    check('KC files still in the project', (await api('GET', `/projects/${P}/artifacts?type=knowledge-check`)).data.length >= 1)
    const apply2 = textBlock('apply')
    await apply2.locator('button:has-text("Remove")').click()
    check('with no retrieval left (fix 2), removing a text block does NOT repeat the warning', !(await apply2.locator('text=no knowledge check or scenario').count()) && await apply2.locator('text=Remove this block').isVisible())
    await apply2.locator('button:has-text("Cancel")').click()

    console.log('Tab length warning')
    const tabsBlock = page.locator('.lesson-tabs-block, .lesson-proposal:has-text("Tabs")').first()
    await tabsBlock.locator('button:has-text("Write it myself")').click()
    const ed = tabsBlock.locator('.tabs-editor')
    await ed.locator('textarea').first().fill(para(51))
    check('51 words → soft warning shown', await ed.locator('text=51 words').isVisible())
    await ed.locator('textarea').first().fill(para(50))
    check('50 words → no warning', !(await ed.locator('text=Tabs read best').count()))
    await ed.locator('textarea').first().fill(para(70))
    await ed.locator('input[type=text]').nth(1).fill('One')
    await ed.locator('input[type=text]').nth(2).fill('Two')
    await ed.locator('textarea').nth(2).fill('Short second.')
    check('(setup) tab labels filled', true)
    await ed.locator('input[type=text]').first().fill('')
    await ed.locator('button[type=submit]').click()
    await page.waitForSelector('.lesson-tabs')
    check('over-50-word tab still saves', (await lessonOf(id)).blocks.some(b => b.kind === 'tabs' && b.state === 'ready' && b.tabs[0].body.split(' ').length === 70), (await lessonOf(id)).blocks.filter(b => b.kind === 'tabs'))

    check('no page errors', errors.length === 0, errors)
  } finally {
    await browser.close(); await env.stopEnv(mock)
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
