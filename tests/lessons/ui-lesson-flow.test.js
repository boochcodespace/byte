// Browser: the whole lesson flow, including that artifact progress survives other changes
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
  await api('PUT', `/projects/${P}/sources/${PRIMARY}`, { context: { role: 'Team Lead', experience: 'Intermediate', useCase: 'Run better 1:1s', learningObjectives: '' } })
  await api('POST', `/projects/${P}/sources`, { title: 'Second Source', content: '# Second Source\n\nMore changeover detail.' })
  await api('POST', `/projects/${P}/sources/${PRIMARY}/artifacts/generate`, { artifactType: 'knowledge-check' }) // A0, standalone

  const browser = await env.launchBrowser()
  const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(m.text()) })

  try {
    console.log('Create a lesson from the project page')
    await page.goto(`${APP}/projects/${P}`)
    await page.waitForSelector('.lessons-panel')
    check('project page has a Lessons panel with an empty hint', await page.isVisible('.lessons-panel >> text=text-first document'))
    await page.click('.lessons-panel >> text=+ New lesson')
    await page.waitForSelector('#lessonTopic')
    check('both project sources are listed', (await page.$$('.lesson-source-item')).length === 2)
    check('submit disabled until topic and a source are chosen', await page.isDisabled('button:has-text("Plan the lesson")'))
    await page.fill('#lessonTopic', 'Check changeover before locking a schedule')
    check('still disabled with no source', await page.isDisabled('button:has-text("Plan the lesson")'))
    await page.check('label:has-text("Active Listening") input')
    await page.check('label:has-text("Second Source") input')
    check('first ticked source is labelled Primary', await page.isVisible('.lesson-source-item:has-text("Active Listening") .lesson-source-badge'))
    check('only one Primary badge', (await page.$$('.lesson-source-badge')).length === 1)
    await page.click('button:has-text("Plan the lesson")')
    await page.waitForSelector('.bp-editor', { timeout: 20000 })
    const id1 = page.url().split('/').pop()
    check('lands on the new lesson with the blueprint editor', /\/lessons\/[a-z0-9-]+$/.test(page.url()))

    console.log('Blueprint editor')
    check('learner context prefilled from the primary source', (await page.inputValue('#bpRole')) === 'Team Lead' && (await page.inputValue('#bpExperience')) === 'Practicing' && (await page.inputValue('#bpUseCase')) === 'Run better 1:1s')
    check('experience offers Novice / Practicing / Expert', (await page.$$eval('#bpExperience option', os => os.map(o => o.textContent))).join('|') === 'Select level...|Novice|Practicing|Expert')
    check('objective shown', (await page.inputValue('#bpObjective')).startsWith('Apply a changeover check'))
    check('8 sections shown', (await page.$$('.bp-section')).length === 8)
    check('recall sections show their day', await page.isVisible('.bp-kind:has-text("Recall · day 21")'))
    const summary0 = await page.textContent('.bp-summary')
    check('time plan summary shown (text plan and what is left for artifacts)', /Text plan: 3 min/.test(summary0) && /Left for artifacts: 7 min/.test(summary0), summary0)
    await page.screenshot({ path: path.join(SHOT, 'lesson-1-blueprint.png') })

    await page.fill('.bp-section >> nth=1 >> .bp-title', 'EDITED chunk title?')
    await page.click('.bp-section >> nth=3 >> .bp-remove')
    check('removing a section updates the plan', (await page.$$('.bp-section')).length === 7 && /Text plan: 2.2 min/.test(await page.textContent('.bp-summary')))
    await page.fill('#bpRole', 'Planner')
    await page.click('button:has-text("Save changes")')
    await page.waitForFunction(() => document.querySelectorAll('.bp-section').length === 7)
    await page.reload()
    await page.waitForSelector('.bp-editor')
    check('saved edits persist across reload', (await page.inputValue('.bp-section >> nth=1 >> .bp-title')) === 'EDITED chunk title?' && (await page.$$('.bp-section')).length === 7 && (await page.inputValue('#bpRole')) === 'Planner')
    await page.fill('#bpRole', 'Team Lead')
    await page.click('button:has-text("Approve blueprint")')
    await page.waitForSelector('text=Blueprint approved')
    check('approved view lists the sections', (await page.$$('.bp-readonly li')).length === 7)
    await page.click('button:has-text("Edit blueprint")')
    await page.waitForSelector('.bp-editor')
    check('"Edit blueprint" returns to the editor', true)
    await page.click('button:has-text("Approve blueprint")')
    await page.waitForSelector('button:has-text("Write the lesson")')

    console.log('Write the lesson')
    await page.click('button:has-text("Write the lesson")')
    await page.waitForSelector('text=Writing your lesson...', { timeout: 3000 })
    check('shows a loading state while writing', true)
    await page.waitForSelector('.time-meter', { timeout: 20000 })
    check('lesson view appears with the time meter', true)
    check('hook block', await page.isVisible('.lesson-block-hook >> text=HOOK-BODY'))
    check('chunk titles come from the edited blueprint', await page.isVisible('.lesson-chunk-title:has-text("EDITED chunk title?")'))
    check('2 chunks (one was removed)', (await page.$$('.lesson-block-chunk')).length === 2)
    check('each chunk shows its visual description', (await page.$$('.lesson-visual')).length === 2 && await page.isVisible('.lesson-visual >> text=VISUAL-2'))
    check('apply block', await page.isVisible('.lesson-block-apply >> text=APPLY-BODY'))
    check('3 recall blocks, days 2, 7, 21', (await page.$$eval('.lesson-block-recall .lesson-label', els => els.map(e => e.textContent.replace(/not counted.*/, '').trim()))).join('|') === 'Day 2 recall|Day 7 recall|Day 21 recall')
    check('recall answers are hidden until asked', !/ANSWER-2/.test(await page.content()))
    await page.click('.lesson-block-recall >> nth=0 >> text=Show answer')
    check('Show answer reveals only that answer', /ANSWER-2/.test(await page.content()) && !/ANSWER-7/.test(await page.content()))
    check('3 proposed artifacts with their notes', (await page.$$('.lesson-proposal')).length === 3 && await page.isVisible('text=NOTE-KC') && await page.isVisible('text=NOTE-FLIP') && await page.isVisible('text=NOTE-SCEN'))
    check('proposals offer generate / pick existing / remove', await proposal(page, 'Knowledge Check').locator('button').allTextContents().then(t => t.join('|') === 'Generate for this lesson|Pick existing|Remove'))
    check('nothing was generated for the proposals', (await page.$$('.kc, .scenario, .flipcard-deck')).length === 0)
    const serverTotal0 = (await api('GET', `${L}/${id1}`)).data.lesson.total_minutes
    check('meter matches the server total', (await meterTotal(page)) === serverTotal0, [await meterTotal(page), serverTotal0])
    await page.screenshot({ path: path.join(SHOT, 'lesson-2-drafted.png') })

    console.log('Accept: generate a new knowledge check')
    await proposal(page, 'Knowledge Check').locator('button:has-text("Generate for this lesson")').click()
    await proposal(page, 'Knowledge Check').locator('.context-panel button[type="submit"]').click()
    await page.waitForSelector('text=Generating your knowledge check...', { timeout: 3000 })
    check('this block shows a loading state', true)
    check('other blocks are locked while one action runs', await proposal(page, 'Flip Card Deck').locator('button:has-text("Remove")').isDisabled())
    await page.waitForSelector('.lesson-artifact .kc', { timeout: 20000 })
    check('the knowledge check renders inside the lesson', await page.isVisible('.lesson-artifact >> text=Knowledge Check'))
    check('it is a reference: saved in the primary source folder', fs.readdirSync(path.join(HOME, 'Byte', 'projects', P, 'sources', PRIMARY, 'artifacts')).filter(f => f.startsWith('knowledge-check-')).length === 2)

    console.log('Conflict 5: progress inside an artifact survives other changes')
    await page.click('.lesson-artifact .kc-option:has-text("D1-1")')
    await page.waitForSelector('.lesson-artifact .kc-feedback')
    const progressBefore = await page.textContent('.lesson-artifact .kc-progress')
    check('learner has committed an answer on question 1', /Question 1 of 3/.test(progressBefore) && /R-D1-1/.test(await page.content()))
    const totalBeforeDismiss = await meterTotal(page)
    await proposal(page, 'Flip Card Deck').locator('button:has-text("Remove")').click()
    check('removing a proposal asks for a short confirmation first', await proposal(page, 'Flip Card Deck').locator('text=The artifact stays in your project').isVisible())
    await proposal(page, 'Flip Card Deck').locator('button:has-text("Cancel")').click()
    check('Cancel keeps the proposal', await proposal(page, 'Flip Card Deck').isVisible())
    await proposal(page, 'Flip Card Deck').locator('button:has-text("Remove")').click()
    await proposal(page, 'Flip Card Deck').locator('button:has-text("Yes, remove")').click()
    await page.waitForFunction(() => document.querySelectorAll('.lesson-proposal').length === 1)
    check('(a) removing a proposal updated the time meter', (await meterTotal(page)) < totalBeforeDismiss, [totalBeforeDismiss, await meterTotal(page)])
    check('(a) knowledge check progress is intact after the page refresh', await page.isVisible('.lesson-artifact .kc-feedback') && /R-D1-1/.test(await page.content()) && (await page.$$('.lesson-artifact .kc-option:disabled')).length === 3 && (await page.textContent('.lesson-artifact .kc-progress')) === progressBefore)

    const lessonPath = lessonFile(id1)
    const onDisk = JSON.parse(fs.readFileSync(lessonPath, 'utf-8'))
    onDisk.blocks.find(b => b.kind === 'chunk').body = 'DISK-EDITED chunk text changed outside the page.'
    fs.writeFileSync(lessonPath, JSON.stringify(onDisk))
    check('(b) page still shows the old chunk text before refresh', !/DISK-EDITED/.test(await page.content()))
    await proposal(page, 'Scenario Branching').locator('button:has-text("Generate for this lesson")').click()
    await proposal(page, 'Scenario Branching').locator('.context-panel button[type="submit"]').click()
    await page.waitForSelector('.lesson-artifact .scenario', { timeout: 20000 })
    check('(b) a text block that changed now shows the new text', /DISK-EDITED chunk text/.test(await page.content()))
    check('(b) knowledge check progress is STILL intact (not reset to question 1 fresh)', await page.isVisible('.lesson-artifact .kc-feedback') && (await page.$$('.lesson-artifact .kc-option:disabled')).length === 3 && /R-D1-1/.test(await page.content()))
    check('(b) time meter matches the server after the change', (await meterTotal(page)) === (await api('GET', `${L}/${id1}`)).data.lesson.total_minutes)
    await page.click('.lesson-artifact .kc >> text=Next question →')
    await page.waitForSelector('text=Question 2 of 3')
    check('the knowledge check keeps working from where the learner was', true)
    await page.screenshot({ path: path.join(SHOT, 'lesson-3-with-artifacts.png') })

    console.log('Pick an existing artifact / empty picker / cancel')
    const idB = await draftViaApi({ timeBudgetMinutes: 5 })
    await page.goto(`${APP}/projects/${P}/lessons/${idB}`)
    await page.waitForSelector('.time-meter')
    check('a 5-minute lesson with three proposals is flagged over budget', await page.isVisible('.time-meter-over') && await page.isVisible('text=Over budget by'))
    await proposal(page, 'Flip Card Deck').locator('button:has-text("Pick existing")').click()
    await page.waitForSelector('.artifact-picker')
    check('empty picker explains there is nothing to reuse', await page.isVisible('.artifact-picker >> text=No Flip Card Deck exists in this project yet'))
    await page.click('.artifact-picker >> button:has-text("Cancel")')
    check('Cancel closes the picker', (await page.$('.artifact-picker')) === null)
    await proposal(page, 'Knowledge Check').locator('button:has-text("Pick existing")').click()
    await page.waitForSelector('.picker-item')
    const pickerCount = (await page.$$('.picker-item')).length
    check('picker lists the project\'s knowledge checks, across sources', pickerCount === 2, pickerCount)
    check('each entry names its source', await page.isVisible('.picker-item >> text=Active Listening in the Workplace'))
    await page.screenshot({ path: path.join(SHOT, 'lesson-4-picker.png') })
    await page.locator('.picker-item >> nth=1').locator('button:has-text("Use this")').click()   // the older, standalone one (A0)
    await page.waitForSelector('.lesson-artifact .kc')
    check('picked artifact renders in place and the picker closes', (await page.$('.artifact-picker')) === null)
    const lessonB = (await api('GET', `${L}/${idB}`)).data
    const pickedBlock = lessonB.lesson.blocks.find(b => b.artifact_type === 'knowledge-check')
    check('block stores a reference to the existing artifact', pickedBlock.state === 'ready' && pickedBlock.ref.source === PRIMARY, pickedBlock)
    check('nothing was generated (no new artifact folder)', fs.readdirSync(path.join(HOME, 'Byte', 'projects', P, 'sources', PRIMARY, 'artifacts')).filter(f => f.startsWith('knowledge-check-')).length === 2)

    console.log('Orphaned reference: kept, flagged, re-pointable')
    fs.rmSync(path.join(HOME, 'Byte', 'projects', P, 'sources', PRIMARY, 'artifacts', pickedBlock.ref.artifact), { recursive: true, force: true })
    await page.reload()
    await page.waitForSelector('.time-meter')
    check('block is kept and shows "no longer available"', await page.isVisible('.lesson-unavailable >> text=no longer available') && await page.isVisible('.lesson-unavailable >> text=nothing was deleted'))
    check('lesson block count unchanged', (await api('GET', `${L}/${idB}`)).data.lesson.blocks.length === lessonB.lesson.blocks.length)
    await page.click('.lesson-unavailable >> button:has-text("Pick another")')
    await page.waitForSelector('.picker-item')
    await page.click('.picker-item >> button:has-text("Use this")')
    await page.waitForSelector('.lesson-artifact .kc')
    check('"Pick another" re-points the slot', (await page.$('.lesson-unavailable')) === null)

    console.log('C2 commit 1: Remove and Replace (progress in other blocks is preserved)')
    const idR = await draftViaApi()
    for (const type of ['flip-card-deck', 'knowledge-check', 'scenario-branching']) {
      const b = (await api('GET', `${L}/${idR}`)).data.lesson.blocks.find(x => x.artifact_type === type)
      await api('POST', `${L}/${idR}/blocks/${b.id}/artifact`, { mode: 'new' })
    }
    await page.goto(`${APP}/projects/${P}/lessons/${idR}`)
    await page.waitForSelector('.lesson-artifact .flipcard-deck')
    check('a ready artifact block offers Regenerate, Replace and Remove', (await page.locator('.lesson-artifact:has(.kc) >> .lesson-actions >> button').allTextContents()).join('|') === 'Regenerate|Replace|Remove')
    // build up progress in the knowledge check and the scenario
    await page.click('.lesson-artifact .kc-option:has-text("D1-1")')
    await page.waitForSelector('.lesson-artifact .kc-feedback')
    await page.click('.lesson-artifact .scenario-choice:has-text("weak one")')
    await page.waitForSelector('.lesson-artifact .scenario-feedback')
    const kcProgress = async () => (await page.isVisible('.lesson-artifact .kc-feedback')) && (await page.$$('.lesson-artifact .kc-option:disabled')).length === 3 && (await page.textContent('.lesson-artifact .kc-progress')).includes('Question 1 of 3')
    const scenProgress = async () => (await page.isVisible('.lesson-artifact .scenario-feedback')) && (await page.$$('.lesson-artifact .scenario-choice:disabled')).length === 2
    check('progress set up: a committed answer in the knowledge check and in the scenario', (await kcProgress()) && (await scenProgress()))
    const flipFolder = (await api('GET', `${L}/${idR}`)).data.lesson.blocks.find(b => b.artifact_type === 'flip-card-deck').ref.artifact
    const flipFile = path.join(HOME, 'Byte', 'projects', P, 'sources', PRIMARY, 'artifacts', flipFolder, 'artifact.json')

    // REPLACE the flip deck with a newly generated one
    const flipBlock = page.locator('.lesson-artifact:has(.flipcard-deck)')
    await flipBlock.locator('button:has-text("Replace")').click()
    check('Replace offers two choices: pick another existing, or generate a new one', await flipBlock.locator('button:has-text("Pick another existing")').isVisible() && await flipBlock.locator('button:has-text("Generate a new one")').isVisible())
    await flipBlock.locator('button:has-text("Generate a new one")').click()
    await flipBlock.locator('.context-panel button[type="submit"]').click()
    await page.waitForSelector('text=Generating your flip card deck...', { timeout: 3000 })
    check('a spinner shows in the block being replaced', true)
    await page.waitForFunction(() => !document.body.innerText.includes('Generating your flip card deck...'), null, { timeout: 20000 })
    const flipAfter = (await api('GET', `${L}/${idR}`)).data.lesson.blocks.find(b => b.artifact_type === 'flip-card-deck').ref.artifact
    check('the block now points at a NEW flip deck', flipAfter !== flipFolder && /^flip-card-deck-\d+$/.test(flipAfter), [flipFolder, flipAfter])
    check('the replaced flip deck\'s files are untouched', fs.existsSync(flipFile))
    check('replacing the flip deck did NOT reset the knowledge check', await kcProgress())
    check('replacing the flip deck did NOT reset the scenario', await scenProgress())

    // REMOVE the flip deck, with confirmation
    await flipBlock.locator('button:has-text("Remove")').click()
    await flipBlock.locator('button:has-text("Cancel")').click()
    check('Cancel keeps a ready block', await flipBlock.isVisible())
    const totalWithFlip = await meterTotal(page)
    await flipBlock.locator('button:has-text("Remove")').click()
    check('the confirmation says the artifact stays in the project', await flipBlock.locator('text=The artifact stays in your project').isVisible())
    await flipBlock.locator('button:has-text("Yes, remove")').click()
    await page.waitForFunction(() => document.querySelectorAll('.flipcard-deck').length === 0, null, { timeout: 10000 })
    check('the block is gone from the lesson', (await page.$('.flipcard-deck')) === null)
    check('the time meter dropped', (await meterTotal(page)) < totalWithFlip, [totalWithFlip, await meterTotal(page)])
    check('removing the flip deck did NOT reset the knowledge check', await kcProgress())
    check('removing the flip deck did NOT reset the scenario', await scenProgress())
    check('both flip decks\' files still exist on disk', fs.existsSync(flipFile) && fs.existsSync(path.join(HOME, 'Byte', 'projects', P, 'sources', PRIMARY, 'artifacts', flipAfter, 'artifact.json')))
    check('both are still listed in the project (picker source)', await api('GET', `/projects/${P}/artifacts?type=flip-card-deck`).then(r => r.data.some(a => a.folder === flipFolder) && r.data.some(a => a.folder === flipAfter)))

    // REPLACE the scenario by picking another existing one; the KC keeps its progress
    const scenBlock = page.locator('.lesson-artifact:has(.scenario)')
    const scenFolderBefore = (await api('GET', `${L}/${idR}`)).data.lesson.blocks.find(b => b.artifact_type === 'scenario-branching').ref.artifact
    await api('POST', `/projects/${P}/sources/${PRIMARY}/artifacts/generate`, { artifactType: 'scenario-branching' })   // a second scenario to pick
    await scenBlock.locator('button:has-text("Replace")').click()
    await scenBlock.locator('button:has-text("Pick another existing")').click()
    await page.waitForSelector('.artifact-picker .picker-item')
    check('the picker marks the artifact already in use', await page.isVisible('.picker-item button:has-text("In this lesson")') && await page.isDisabled('.picker-item button:has-text("In this lesson")'))
    check('the picker offers the other scenario', (await page.$$('.picker-item button:has-text("Use this")')).length >= 1)
    await page.click('.picker-item button:has-text("Use this")')
    await page.waitForFunction(() => !document.querySelector('.artifact-picker'))
    check('the scenario slot now points at a different artifact', (await api('GET', `${L}/${idR}`)).data.lesson.blocks.find(b => b.artifact_type === 'scenario-branching').ref.artifact !== scenFolderBefore)
    check('the replaced scenario\'s files are untouched', fs.existsSync(path.join(HOME, 'Byte', 'projects', P, 'sources', PRIMARY, 'artifacts', scenFolderBefore, 'artifact.json')))
    check('the replaced scenario starts fresh (new artifact), as expected', (await page.$('.lesson-artifact .scenario-feedback')) === null)
    check('replacing the scenario did NOT reset the knowledge check', await kcProgress())
    await page.screenshot({ path: path.join(SHOT, 'lesson-5-remove-replace.png') })


    console.log('C2 commit 2: context panel, generation_context, Regenerate')
    const idP = await draftViaApi()
    await page.goto(`${APP}/projects/${P}/lessons/${idP}`)
    await page.waitForSelector('.lesson-proposal')
    const flipP = proposal(page, 'Flip Card Deck')
    const kcP = proposal(page, 'Knowledge Check')
    const scenP = proposal(page, 'Scenario Branching')
    const optionsOf = (loc, n) => loc.locator('.context-panel select').nth(n).locator('option').allTextContents()

    await flipP.locator('button:has-text("Generate for this lesson")').click()
    check('"Generate for this lesson" opens a context panel instead of generating at once', await flipP.locator('.context-panel').isVisible() && (await page.$('.flipcard-deck')) === null)
    check('the panel has Focus, Source section, Count, Experience level, and Notes', await Promise.all(['Focus', 'Source section', 'Number of cards', 'Experience level', 'Notes'].map(t => flipP.locator(`.context-panel label:has-text("${t}")`).isVisible())).then(a => a.every(Boolean)))
    check('flip deck count is limited to the in-lesson maximum (default 4, 3 to 4)', (await optionsOf(flipP, 0)).join('|') === 'Default (4)|3|4', await optionsOf(flipP, 0))
    check('experience offers the lesson level plus Novice / Practicing / Expert', (await optionsOf(flipP, 1)).join('|') === 'Lesson level (Practicing)|Novice|Practicing|Expert', await optionsOf(flipP, 1))
    await flipP.screenshot({ path: path.join(SHOT, 'lesson-6-context-panel.png') })
    await flipP.locator('.context-panel button:has-text("Cancel")').click()
    check('Cancel closes the panel and generates nothing', (await flipP.locator('.context-panel').count()) === 0 && await flipP.isVisible() && (await page.$('.flipcard-deck')) === null)
    await kcP.locator('button:has-text("Generate for this lesson")').click()
    check('knowledge check count: default 3, up to 3 (2 to 3)', (await optionsOf(kcP, 0)).join('|') === 'Default (3)|2|3' && await kcP.locator('.context-panel label:has-text("Number of questions")').isVisible())
    await kcP.locator('.context-panel button:has-text("Cancel")').click()
    await scenP.locator('button:has-text("Generate for this lesson")').click()
    check('scenario count: default 2, up to 3 (2 to 3)', (await optionsOf(scenP, 0)).join('|') === 'Default (2)|2|3' && await scenP.locator('.context-panel label:has-text("Number of decisions")').isVisible())
    await scenP.locator('.context-panel button:has-text("Cancel")').click()
    await flipP.locator('button:has-text("Generate for this lesson")').click()
    await flipP.locator('button:has-text("Pick existing")').click()
    check('opening the picker closes the panel (one at a time)', (await flipP.locator('.context-panel').count()) === 0 && await flipP.locator('.artifact-picker').isVisible())
    await flipP.locator('.artifact-picker button:has-text("Cancel")').click()

    // generate the flip deck WITH context
    await flipP.locator('button:has-text("Generate for this lesson")').click()
    const fp = flipP.locator('.context-panel')
    await fp.locator('label:has-text("Focus") input').fill('FOCUS-ROLES host client server')
    await fp.locator('label:has-text("Source section") input').fill('Roles section')
    await fp.locator('label:has-text("Number of cards") select').selectOption('3')
    await fp.locator('label:has-text("Experience level") select').selectOption('Expert')
    await fp.locator('label:has-text("Notes") textarea').fill('NOTES-MIXUPS use the mix-ups section')
    await fp.locator('button[type="submit"]').click()
    await page.waitForSelector('text=Generating your flip card deck...', { timeout: 3000 })
    check('the panel is locked while it generates', await fp.locator('button[type="submit"]').isDisabled())
    await page.waitForSelector('.lesson-artifact .flipcard-deck', { timeout: 20000 })
    const flipBlk = page.locator('.lesson-artifact:has(.flipcard-deck)')
    check('the new deck reflects the focus (mock echoes it)', /FOCUS-ROLES host client server/.test(await flipBlk.locator('.flipcard-text').first().textContent()))
    check('the block shows what it was generated with', await flipBlk.locator('text=Generated with:').isVisible() && /FOCUS-ROLES/.test(await flipBlk.locator('.lesson-proposal-note').textContent()) && /Roles section/.test(await flipBlk.locator('.lesson-proposal-note').textContent()) && /Expert level/.test(await flipBlk.locator('.lesson-proposal-note').textContent()))
    const ctxStored = (await api('GET', `${L}/${idP}`)).data.lesson.blocks.find(b => b.artifact_type === 'flip-card-deck').generation_context
    check('the context is stored on the block', ctxStored.focus === 'FOCUS-ROLES host client server' && ctxStored.count === 3 && ctxStored.experience === 'Expert' && ctxStored.source_section === 'Roles section', ctxStored)
    const flipFolder1 = (await api('GET', `${L}/${idP}`)).data.lesson.blocks.find(b => b.artifact_type === 'flip-card-deck').ref.artifact

    // an empty panel generates with defaults; then build progress in it
    await kcP.locator('button:has-text("Generate for this lesson")').click()
    await kcP.locator('.context-panel button[type="submit"]').click()
    await page.waitForSelector('.lesson-artifact .kc', { timeout: 20000 })
    check('an empty panel generates with the lesson defaults (nothing stored)', (await api('GET', `${L}/${idP}`)).data.lesson.blocks.find(b => b.artifact_type === 'knowledge-check').generation_context === undefined)
    await page.click('.lesson-artifact .kc-option:has-text("D1-1")')
    await page.waitForSelector('.lesson-artifact .kc-feedback')

    // Regenerate: the panel opens prefilled with the stored context
    await flipBlk.locator('button:has-text("Regenerate")').click()
    const rp = flipBlk.locator('.context-panel')
    check('Regenerate opens the panel prefilled with the stored context', (await rp.locator('label:has-text("Focus") input').inputValue()) === 'FOCUS-ROLES host client server' && (await rp.locator('label:has-text("Source section") input').inputValue()) === 'Roles section' && (await rp.locator('label:has-text("Number of cards") select').inputValue()) === '3' && (await rp.locator('label:has-text("Experience level") select').inputValue()) === 'Expert' && (await rp.locator('label:has-text("Notes") textarea').inputValue()).startsWith('NOTES-MIXUPS'))
    check('the submit button says Regenerate', (await rp.locator('button[type="submit"]').textContent()) === 'Regenerate')
    await rp.locator('label:has-text("Focus") input').fill('FOCUS-TWO a different emphasis')
    await rp.locator('button[type="submit"]').click()
    await page.waitForFunction(() => /FOCUS-TWO/.test(document.querySelector('.flipcard-text')?.textContent || ''), null, { timeout: 20000 })
    const flipFolder2 = (await api('GET', `${L}/${idP}`)).data.lesson.blocks.find(b => b.artifact_type === 'flip-card-deck').ref.artifact
    check('Regenerate produced a DIFFERENT artifact that reflects the edited focus', flipFolder2 !== flipFolder1 && !/FOCUS-ROLES/.test(await flipBlk.locator('.flipcard-text').first().textContent()))
    check('the previous deck\'s files stay on disk and in the project', fs.existsSync(path.join(HOME, 'Byte', 'projects', P, 'sources', PRIMARY, 'artifacts', flipFolder1, 'artifact.json')) && (await api('GET', `/projects/${P}/artifacts?type=flip-card-deck`)).data.some(a => a.folder === flipFolder1))
    check('the panel closed and the note shows the edited context', (await flipBlk.locator('.context-panel').count()) === 0 && /FOCUS-TWO/.test(await flipBlk.locator('.lesson-proposal-note').textContent()))
    check('Regenerate did NOT reset progress in the knowledge check', await page.isVisible('.lesson-artifact .kc-feedback') && (await page.$$('.lesson-artifact .kc-option:disabled')).length === 3)

    // Replace → Generate a new one opens the same prefilled panel
    await flipBlk.locator('button:has-text("Replace")').click()
    await flipBlk.locator('button:has-text("Generate a new one")').click()
    check('Replace, then Generate a new one, opens the prefilled panel', (await flipBlk.locator('.context-panel label:has-text("Focus") input').inputValue()) === 'FOCUS-TWO a different emphasis')
    await flipBlk.locator('.context-panel button:has-text("Cancel")').click()

    // a failed regenerate keeps the panel (and what was typed) open, with Retry
    mode = 'notjson'
    await flipBlk.locator('button:has-text("Regenerate")').click()
    await flipBlk.locator('.context-panel label:has-text("Focus") input').fill('FOCUS-AFTER-RETRY')
    await flipBlk.locator('.context-panel button[type="submit"]').click()
    await page.waitForSelector('.lesson-artifact .error-state', { timeout: 20000 })
    check('a failure shows a plain-language error with Retry', /Generation failed to produce valid output/.test(await flipBlk.locator('.error-state').textContent()) && await flipBlk.locator('.error-state >> text=Retry').isVisible())
    check('the panel stays open with what was typed', (await flipBlk.locator('.context-panel label:has-text("Focus") input').inputValue()) === 'FOCUS-AFTER-RETRY')
    check('the block still holds its previous artifact and context', (await api('GET', `${L}/${idP}`)).data.lesson.blocks.find(b => b.artifact_type === 'flip-card-deck').ref.artifact === flipFolder2 && /FOCUS-TWO/.test(await flipBlk.locator('.flipcard-text').first().textContent()))
    mode = 'ok'
    await flipBlk.locator('.error-state >> text=Retry').click()
    await page.waitForFunction(() => /FOCUS-AFTER-RETRY/.test(document.querySelector('.flipcard-text')?.textContent || ''), null, { timeout: 20000 })
    check('Retry succeeds with the typed context and closes the panel', (await flipBlk.locator('.context-panel').count()) === 0)
    check('progress in the knowledge check survived all of that', await page.isVisible('.lesson-artifact .kc-feedback') && (await page.$$('.lesson-artifact .kc-option:disabled')).length === 3)

    console.log('C2 commit 3: tabs block, Insert here, fix 2')
    const idN = await draftViaApi({}, { withTabs: true })
    await page.goto(`${APP}/projects/${P}/lessons/${idN}`)
    await page.waitForSelector('.lesson-proposal')
    const lessonN = async () => (await api('GET', `${L}/${idN}`)).data.lesson
    const blockEl = idx => page.locator('.lesson-blocks > *:not(.insert-control):not(.insert-flow)').nth(idx)
    const insertAfter = async idx => { await blockEl(idx).locator('xpath=following-sibling::*[position()<=2]').locator('button:has-text("+ Insert here")').click() }

    const nonRecall = (await lessonN()).blocks.filter(b => b.kind !== 'recall').length
    check('Insert here appears after every block except the recall prompts', (await page.$$('.insert-control')).length === nonRecall, [(await page.$$('.insert-control')).length, nonRecall])
    const propTabs = page.locator('.lesson-proposal:has-text("Suggested: Tabs block")')
    check('a proposed tabs block shows its note and its choices', await propTabs.locator('text=NOTE-TABS').isVisible() && (await propTabs.locator('button').allTextContents()).join('|') === 'Generate tabs|Write it myself|Remove')

    // generate the proposal with an instruction
    await propTabs.locator('button:has-text("Generate tabs")').click()
    const tcp = propTabs.locator('.context-panel')
    check('the tabs panel calls the focus field "Instruction" and offers a tab count', await tcp.locator('label:has-text("Instruction")').isVisible() && (await tcp.locator('select').first().locator('option').allTextContents()).join('|') === 'Let Byte decide|2|3|4|5')
    await tcp.locator('label:has-text("Instruction") input').fill('compare host, client, and server')
    await tcp.locator('label:has-text("Number of tabs") select').selectOption('3')
    await tcp.locator('button[type="submit"]').click()
    await page.waitForSelector('.lesson-tabs-block [role="tablist"]', { timeout: 20000 })
    const tabsBlk = page.locator('.lesson-tabs-block')
    check('the tabs are generated from the instruction (title reflects it)', /Tabs :: compare host, client, and server/.test(await tabsBlk.locator('.lesson-chunk-title').textContent()) && (await tabsBlk.locator('[role="tab"]').count()) === 3)
    check('the block shows what it was generated with', /instruction|focus/i.test(await tabsBlk.locator('.lesson-proposal-note').textContent()) && /compare host, client, and server/.test(await tabsBlk.locator('.lesson-proposal-note').textContent()))
    check('a generated block is not marked as edited', (await tabsBlk.locator('.lesson-badge').count()) === 0)
    await tabsBlk.evaluate(el => el.scrollIntoView({ block: 'center' }))
    const tbb = await tabsBlk.boundingBox()
    await page.screenshot({ path: path.join(SHOT, 'lesson-7-tabs.png'), clip: { x: tbb.x - 10, y: tbb.y - 10, width: tbb.width + 20, height: tbb.height + 20 } })

    console.log('Tabs by keyboard alone')
    const roleOfFocus = () => page.evaluate(() => document.activeElement?.getAttribute('role') || document.activeElement?.tagName)
    const selectedLabel = () => tabsBlk.locator('[role="tab"][aria-selected="true"]').textContent()
    const visiblePanels = () => tabsBlk.locator('[role="tabpanel"]:not([hidden])').count()
    await tabsBlk.locator('xpath=preceding-sibling::*[1]').locator('button:has-text("+ Insert here")').focus()
    let guard = 0
    while ((await roleOfFocus()) !== 'tab' && guard++ < 8) await page.keyboard.press('Tab')
    check('Tab reaches the tab list', (await roleOfFocus()) === 'tab')
    check('...and lands on the SELECTED tab (one tab stop for the whole list)', (await page.evaluate(() => document.activeElement.getAttribute('aria-selected'))) === 'true' && (await selectedLabel()) === 'Tab1')
    check('the other tabs are not in the tab order (tabindex -1)', (await tabsBlk.locator('[role="tab"][tabindex="-1"]').count()) === 2)
    check('only one panel is visible', (await visiblePanels()) === 1 && /TABBODY1/.test(await tabsBlk.locator('[role="tabpanel"]:not([hidden])').textContent()))
    await page.keyboard.press('ArrowRight')
    check('ArrowRight selects and focuses the next tab and shows its panel', (await selectedLabel()) === 'Tab2' && (await page.evaluate(() => document.activeElement.textContent)) === 'Tab2' && /TABBODY2/.test(await tabsBlk.locator('[role="tabpanel"]:not([hidden])').textContent()) && (await visiblePanels()) === 1)
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    check('ArrowRight wraps from the last tab to the first', (await selectedLabel()) === 'Tab1')
    await page.keyboard.press('ArrowLeft')
    check('ArrowLeft wraps from the first tab to the last', (await selectedLabel()) === 'Tab3')
    await page.keyboard.press('Home')
    check('Home selects the first tab', (await selectedLabel()) === 'Tab1')
    await page.keyboard.press('End')
    check('End selects the last tab', (await selectedLabel()) === 'Tab3')
    await page.keyboard.press('Tab')
    check('Tab moves from the tab list into the open panel', (await roleOfFocus()) === 'tabpanel')
    await page.keyboard.press('Tab')
    check('...and then on to the next control (Edit)', (await page.evaluate(() => document.activeElement.textContent)) === 'Edit')
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Shift+Tab')
    check('Shift+Tab goes back to the selected tab', (await roleOfFocus()) === 'tab' && (await selectedLabel()) === 'Tab3')
    const aria = await tabsBlk.evaluate(el => {
      const list = el.querySelector('[role="tablist"]')
      const tabs = [...el.querySelectorAll('[role="tab"]')]
      const panels = [...el.querySelectorAll('[role="tabpanel"]')]
      return {
        listLabel: list.getAttribute('aria-label'),
        wired: tabs.every(t => { const p = document.getElementById(t.getAttribute('aria-controls')); return p && p.getAttribute('role') === 'tabpanel' && p.getAttribute('aria-labelledby') === t.id }),
        hasSelected: tabs.every(t => ['true', 'false'].includes(t.getAttribute('aria-selected'))),
        hiddenMatchesSelection: panels.every((p, i) => p.hidden === (tabs[i].getAttribute('aria-selected') !== 'true')),
        count: [tabs.length, panels.length],
      }
    })
    check('ARIA: the tab list is labelled by the block heading', /Tabs :: compare host/.test(aria.listLabel), aria.listLabel)
    check('ARIA: every tab controls a panel that it labels, with matching ids', aria.wired)
    check('ARIA: every tab states aria-selected; hidden panels match', aria.hasSelected && aria.hiddenMatchesSelection && aria.count.join() === '3,3')
    await page.keyboard.press('Home')

    console.log('The time meter counts tab text')
    const meterBefore = await meterTotal(page)
    const blockBefore = (await lessonN()).blocks.find(b => b.kind === 'tabs')
    const wordsOfStr = (...p) => p.filter(x => typeof x === 'string').join(' ').trim().split(/\s+/).filter(Boolean).length
    const expected = b => Math.round(((wordsOfStr(b.title) + b.tabs.reduce((a, t) => a + wordsOfStr(t.label, t.body), 0)) / 200 + 0.25 * b.tabs.length) * 10) / 10
    check('block time = words / 200 plus 15 seconds per tab', blockBefore.minutes === expected(blockBefore), [blockBefore.minutes, expected(blockBefore)])
    check('the meter shows the server total', meterBefore === (await lessonN()).total_minutes)

    console.log('Edit tabs inline')
    await tabsBlk.getByRole('button', { name: /^Edit/ }).click()
    const ed = page.locator('.tabs-editor')
    check('the editor shows every tab with label, text, and visual note', (await ed.locator('.tabs-editor-tab').count()) === 3 && (await ed.getByLabel('Tab 1 label').inputValue()) === 'Tab1' && /TABBODY1/.test(await ed.getByLabel('Tab 1 text').inputValue()) && (await ed.getByLabel('Tab 1 visual note').inputValue()) === 'TAB-VISUAL a diagram')
    check('Remove is disabled-aware: allowed at 3 tabs, Move up disabled on the first, Move down on the last', !(await ed.getByLabel('Remove tab 1').isDisabled()) && await ed.getByLabel('Move tab 1 up').isDisabled() && await ed.getByLabel('Move tab 3 down').isDisabled())
    await ed.getByLabel('Tab 2 label').fill('Client edited')
    await ed.getByLabel('Tab 2 text').fill('EDITED-BODY written by hand.')
    await ed.getByLabel('Move tab 3 up').click()
    check('Move up reorders the tabs', (await ed.getByLabel('Tab 2 label').inputValue()) === 'Tab3' && (await ed.getByLabel('Tab 3 label').inputValue()) === 'Client edited')
    await ed.locator('button:has-text("Add tab")').click()
    await ed.getByLabel('Tab 4 label').fill('Extra')
    await ed.getByLabel('Tab 4 text').fill(para(100))
    await ed.locator('button:has-text("Add tab")').click()
    await ed.getByLabel('Tab 5 label').fill('Fifth')
    await ed.getByLabel('Tab 5 text').fill('Fifth tab text.')
    check('Add tab stops at 5 tabs', await ed.locator('button:has-text("Add tab")').isDisabled())
    await ed.getByLabel('Remove tab 5').click()
    check('Remove tab works and re-enables Add tab', !(await ed.locator('button:has-text("Add tab")').isDisabled()) && (await ed.locator('.tabs-editor-tab').count()) === 4)
    await ed.locator('button[type="submit"]').click()
    await page.waitForSelector('.lesson-tabs-block [role="tablist"]')
    check('Save shows 4 tabs in the new order', (await tabsBlk.locator('[role="tab"]').allTextContents()).join('|') === 'Tab1|Tab3|Client edited|Extra')
    check('the block now says "Edited by you"', await tabsBlk.locator('.lesson-badge').isVisible() && /Edited by you/.test(await tabsBlk.locator('.lesson-badge').textContent()))
    const blockAfter = (await lessonN()).blocks.find(b => b.kind === 'tabs')
    check('the saved block matches (ids kept, new tab added)', blockAfter.tabs.length === 4 && blockAfter.tabs[2].label === 'Client edited' && blockAfter.edited === true)
    check('the time grew with the new tab text, by the same formula', blockAfter.minutes === expected(blockAfter) && blockAfter.minutes > blockBefore.minutes, [blockBefore.minutes, blockAfter.minutes])
    check('the meter moved to the new server total', (await meterTotal(page)) === (await lessonN()).total_minutes && (await meterTotal(page)) > meterBefore, [meterBefore, await meterTotal(page)])
    await tabsBlk.getByRole('button', { name: /^Edit/ }).click()
    await page.locator('.tabs-editor button:has-text("Cancel")').click()
    check('Cancel leaves the block as it was', (await tabsBlk.locator('[role="tab"]').count()) === 4 && (await page.$('.tabs-editor')) === null)

    console.log('Regenerate over hand edits asks first')
    await tabsBlk.locator('button:has-text("Regenerate")').click()
    await tabsBlk.locator('.context-panel button[type="submit"]').click()
    check('a warning says the edits will be replaced', await tabsBlk.locator('text=replaces the edits you made').isVisible() && (await tabsBlk.locator('.context-panel button[type="submit"]').textContent()) === 'Yes, replace my edits')
    check('nothing was generated yet', (await lessonN()).blocks.find(b => b.kind === 'tabs').tabs.length === 4)
    await tabsBlk.locator('.context-panel button:has-text("Back")').click()
    check('Back returns to the panel', (await tabsBlk.locator('.context-panel button[type="submit"]').textContent()) === 'Regenerate')
    await tabsBlk.locator('.context-panel button[type="submit"]').click()
    await tabsBlk.locator('.context-panel button[type="submit"]').click()
    await page.waitForFunction(() => document.querySelectorAll('.lesson-tabs-block [role="tab"]').length === 3, null, { timeout: 20000 })
    check('after confirming, the tabs are regenerated and the edited badge is gone', (await tabsBlk.locator('.lesson-badge').count()) === 0 && (await lessonN()).blocks.find(b => b.kind === 'tabs').edited === false)

    console.log('Insert here')
    // pick a chunk (index of the first chunk block)
    const chunkIdx = (await lessonN()).blocks.findIndex(b => b.kind === 'chunk')
    const countBefore = (await lessonN()).blocks.length
    await insertAfter(chunkIdx)
    check('the Insert menu lists Tabs, the text kinds, and every artifact type', await page.locator('.insert-control[role="group"] button').allTextContents().then(t => t.join('|') === 'Tabs block|Chunk|Apply block|Recall prompt|Flip Card Deck|Scenario Branching|Knowledge Check|Cancel'))
    const menu = page.locator('.insert-control[role="group"]')
    await menu.evaluate(el => el.scrollIntoView({ block: 'center' }))
    const mbb = await menu.boundingBox()
    await page.screenshot({ path: path.join(SHOT, 'lesson-8-insert-menu.png'), clip: { x: mbb.x - 10, y: mbb.y - 40, width: mbb.width + 20, height: mbb.height + 80 } })
    await page.locator('.insert-control button:has-text("Tabs block")').click()
    check('a kind offers how to add it: write it myself, or generate', await page.locator('.insert-control[role="group"] button').allTextContents().then(t => t.join('|') === 'Write it myself|Generate...|Back|Cancel'))
    await page.locator('.insert-control button:has-text("Back")').click()
    await page.locator('.insert-control button:has-text("Cancel")').click()
    check('Back and Cancel work', (await page.$$('.insert-control[role="group"]')).length === 0)

    // tabs, written by hand
    await insertAfter(chunkIdx)
    await page.locator('.insert-control button:has-text("Tabs block")').click()
    await page.locator('.insert-control button:has-text("Write it myself")').click()
    const ied = page.locator('.insert-flow .tabs-editor')
    check('"Write it myself" opens an editor with two blank tabs', (await ied.locator('.tabs-editor-tab').count()) === 2 && (await ied.getByLabel('Tab 1 label').inputValue()) === '')
    check('with two tabs the Remove tab buttons are disabled', await ied.getByLabel('Remove tab 1').isDisabled())
    await ied.getByLabel('Block heading').fill('My own tabs')
    await ied.getByLabel('Tab 1 label').fill('First')
    await ied.getByLabel('Tab 1 text').fill('First idea written by hand.')
    await ied.getByLabel('Tab 2 label').fill('Second')
    await ied.getByLabel('Tab 2 text').fill('Second idea written by hand.')
    const meterPre = await meterTotal(page)
    await ied.locator('button[type="submit"]').click()
    await page.waitForFunction(() => document.querySelectorAll('.lesson-tabs-block').length === 2, null, { timeout: 15000 })
    const lw = await lessonN()
    const wroteIdx = lw.blocks.findIndex(b => b.title === 'My own tabs')
    check('the block appears directly after the chosen block', wroteIdx === chunkIdx + 1 && lw.blocks.length === countBefore + 1, [wroteIdx, chunkIdx])
    check('it is marked edited, and the meter went up', lw.blocks[wroteIdx].edited === true && (await meterTotal(page)) > meterPre)
    check('the insert flow closed', (await page.$('.insert-flow')) === null)

    // tabs, generated from an instruction
    await insertAfter(chunkIdx)
    await page.locator('.insert-control button:has-text("Tabs block")').click()
    await page.locator('.insert-control button:has-text("Generate...")').click()
    const igp = page.locator('.insert-flow .context-panel')
    await igp.locator('label:has-text("Instruction") input').fill('compare novice, practicing, and expert')
    await igp.locator('button[type="submit"]').click()
    await page.waitForSelector('text=Adding to your lesson...', { timeout: 3000 })
    await page.waitForFunction(() => document.querySelectorAll('.lesson-tabs-block').length === 3, null, { timeout: 20000 })
    check('a generated tabs block can be inserted from an instruction', (await lessonN()).blocks.some(b => b.kind === 'tabs' && /compare novice, practicing, and expert/.test(b.title)))

    // artifacts: pick existing, generate new, re-add a removed one
    const kcExisting = (await api('GET', `/projects/${P}/artifacts?type=knowledge-check`)).data
    await insertAfter(0)
    await page.locator('.insert-control button:has-text("Knowledge Check")').click()
    await page.locator('.insert-control button:has-text("Pick existing")').click()
    await page.waitForSelector('.insert-flow .picker-item')
    check('the insert picker lists the project\'s knowledge checks', (await page.$$('.insert-flow .picker-item')).length === kcExisting.length)
    await page.locator('.insert-flow .picker-item button:has-text("Use this")').first().click()
    await page.waitForSelector('.lesson-artifact .kc', { timeout: 15000 })
    const insertedKc = (await lessonN()).blocks.find(b => b.kind === 'artifact' && b.artifact_type === 'knowledge-check')
    check('an existing knowledge check is inserted right after the hook', (await lessonN()).blocks[1].id === insertedKc.id && insertedKc.state === 'ready')
    await page.click('.lesson-artifact .kc-option:has-text("D1-1")')
    await page.waitForSelector('.lesson-artifact .kc-feedback')
    const kcKept = async () => (await page.isVisible('.lesson-artifact .kc-feedback')) && (await page.$$('.lesson-artifact .kc-option:disabled')).length === 3

    await insertAfter(0)
    await page.locator('.insert-control button:has-text("Flip Card Deck")').click()
    await page.locator('.insert-control button:has-text("Generate new...")').click()
    const ifp = page.locator('.insert-flow .context-panel')
    await ifp.locator('label:has-text("Focus") input').fill('FOCUS-INSERTED-FLIP')
    await ifp.locator('button[type="submit"]').click()
    await page.waitForSelector('.lesson-artifact .flipcard-deck', { timeout: 20000 })
    check('a new flip deck can be generated at the insert point, with context', /FOCUS-INSERTED-FLIP/.test(await page.locator('.lesson-artifact .flipcard-text').first().textContent()) && (await lessonN()).blocks.find(b => b.artifact_type === 'flip-card-deck' && b.generation_context && b.generation_context.focus === 'FOCUS-INSERTED-FLIP') !== undefined)
    check('inserting blocks did NOT reset progress in the knowledge check', await kcKept())

    // the gap this closes: remove a KC, then add the same artifact back
    const kcRef = (await lessonN()).blocks.find(b => b.id === insertedKc.id).ref
    const kcBlk = page.locator('.lesson-artifact:has(.kc)')
    await kcBlk.locator('button:has-text("Remove")').click()
    await kcBlk.locator('button:has-text("Yes, remove")').click()
    await page.waitForFunction(() => document.querySelectorAll('.lesson-artifact .kc').length === 0, null, { timeout: 10000 })
    check('(setup) the knowledge check block is removed; its files remain', fs.existsSync(path.join(HOME, 'Byte', 'projects', P, 'sources', kcRef.source, 'artifacts', kcRef.artifact, 'artifact.json')))
    await insertAfter(0)
    await page.locator('.insert-control button:has-text("Knowledge Check")').click()
    await page.locator('.insert-control button:has-text("Pick existing")').click()
    await page.waitForSelector('.insert-flow .picker-item')
    check('the removed artifact is offered in the picker', (await page.$$('.insert-flow .picker-item')).length === kcExisting.length)
    await page.locator('.insert-flow .picker-item button:has-text("Use this")').nth(kcExisting.findIndex(a => a.folder === kcRef.artifact)).click()
    await page.waitForSelector('.lesson-artifact .kc', { timeout: 15000 })
    check('a removed artifact can be re-added to the lesson', (await lessonN()).blocks.some(b => b.kind === 'artifact' && b.ref && b.ref.artifact === kcRef.artifact))
    check('it comes back fresh (a new block, no earlier progress)', (await page.$('.lesson-artifact .kc-feedback')) === null)

    console.log('Insert: failure keeps the lesson unchanged')
    const nBefore = (await lessonN()).blocks.length
    mode = 'notjson'
    await insertAfter(0)
    await page.locator('.insert-control button:has-text("Tabs block")').click()
    await page.locator('.insert-control button:has-text("Generate...")').click()
    await page.locator('.insert-flow .context-panel label:has-text("Instruction") input').fill('WILL-FAIL')
    await page.locator('.insert-flow .context-panel button[type="submit"]').click()
    await page.waitForSelector('.insert-flow .error-state', { timeout: 20000 })
    check('a plain-language error with Retry appears under the insert control', /Generation failed to produce valid output/.test(await page.locator('.insert-flow .error-state').textContent()) && await page.locator('.insert-flow .error-state >> text=Retry').isVisible())
    check('what was typed is still there, and the lesson is unchanged', (await page.locator('.insert-flow .context-panel label:has-text("Instruction") input').inputValue()) === 'WILL-FAIL' && (await lessonN()).blocks.length === nBefore)
    mode = 'ok'
    await page.locator('.insert-flow .error-state >> text=Retry').click()
    await page.waitForFunction(n => document.querySelectorAll('.lesson-tabs-block').length === n, 4, { timeout: 20000 })
    check('Retry then inserts the block', (await lessonN()).blocks.length === nBefore + 1 && (await page.$('.insert-flow')) === null)

    console.log('Removing a tabs block')
    const editedTabs = page.locator('.lesson-tabs-block:has(.lesson-badge)').first()
    await editedTabs.locator('button:has-text("Remove")').click()
    check('removing an EDITED tabs block warns that edits will be lost', await editedTabs.locator('text=Your edits will be lost').isVisible())
    await editedTabs.locator('button:has-text("Cancel")').click()
    const nTabs = (await page.$$('.lesson-tabs-block')).length
    await editedTabs.locator('button:has-text("Remove")').click()
    await editedTabs.locator('button:has-text("Yes, remove")').click()
    await page.waitForFunction(n => document.querySelectorAll('.lesson-tabs-block').length === n, nTabs - 1, { timeout: 10000 })
    check('the tabs block is removed', (await page.$$('.lesson-tabs-block')).length === nTabs - 1)

    console.log('Fix 2: picking an existing artifact clears the context')
    const flipBlk3 = page.locator('.lesson-artifact:has(.flipcard-deck)').first()
    check('(setup) the generated flip deck shows the context it was made with', /FOCUS-INSERTED-FLIP/.test(await flipBlk3.locator('.lesson-proposal-note').textContent()))
    await api('POST', `/projects/${P}/sources/${PRIMARY}/artifacts/generate`, { artifactType: 'flip-card-deck' })   // another flip deck to pick
    await flipBlk3.locator('button:has-text("Replace")').click()
    await flipBlk3.locator('button:has-text("Pick another existing")').click()
    await page.waitForSelector('.picker-item')
    await page.locator('.picker-item button:has-text("Use this")').first().click()
    await page.waitForFunction(() => !document.querySelector('.artifact-picker'))
    const flipBlk4 = page.locator('.lesson-artifact:has(.flipcard-deck)').first()
    check('the "Generated with" note is gone after picking an existing artifact', (await flipBlk4.locator('.lesson-proposal-note').count()) === 0)
    await flipBlk4.locator('button:has-text("Regenerate")').click()
    const emptyPanel = flipBlk4.locator('.context-panel')
    check('Regenerate on that block opens an EMPTY panel', (await emptyPanel.locator('label:has-text("Focus") input').inputValue()) === '' && (await emptyPanel.locator('label:has-text("Notes") textarea').inputValue()) === '' && (await emptyPanel.locator('label:has-text("Number of cards") select').inputValue()) === '')
    await emptyPanel.locator('button:has-text("Cancel")').click()

    console.log('Proposed tabs written by hand')
    const idN2 = await draftViaApi({}, { withTabs: true })
    await page.goto(`${APP}/projects/${P}/lessons/${idN2}`)
    await page.waitForSelector('.lesson-proposal')
    const prop2 = page.locator('.lesson-proposal:has-text("Suggested: Tabs block")')
    await prop2.locator('button:has-text("Write it myself")').click()
    const ped = prop2.locator('.tabs-editor')
    await ped.getByLabel('Tab 1 label').fill('Host')
    await ped.getByLabel('Tab 1 text').fill('The host runs the session.')
    await ped.getByLabel('Tab 2 label').fill('Client')
    await ped.getByLabel('Tab 2 text').fill('The client joins it.')
    await ped.locator('button[type="submit"]').click()
    await page.waitForSelector('.lesson-tabs-block [role="tablist"]', { timeout: 15000 })
    check('a proposal written by hand becomes a ready, edited tabs block', await page.locator('.lesson-tabs-block .lesson-badge').isVisible() && (await page.$('.lesson-proposal:has-text("Suggested: Tabs block")')) === null)

    console.log('Failure paths')
    mode = 'notjson'
    await page.goto(`${APP}/projects/${P}/lessons/new`)
    await page.waitForSelector('#lessonTopic')
    await page.fill('#lessonTopic', 'A lesson whose blueprint fails')
    await page.check('label:has-text("Active Listening") input')
    await page.click('button:has-text("Plan the lesson")')
    await page.waitForURL(u => /\/lessons\/(?!new$)[a-z0-9-]+$/.test(u.pathname), { timeout: 20000 })
    await page.waitForSelector('.error-state', { timeout: 20000 })
    check('blueprint failure still creates the lesson and offers Retry', /\/lessons\/[a-z0-9-]+$/.test(page.url()) && await page.isVisible('.error-state >> text=Retry') && await page.isVisible('button:has-text("Generate blueprint")'))
    check('failure message is plain language', /Generation failed to produce valid output/.test(await page.textContent('.error-state')))
    mode = 'ok'
    await page.click('.error-state >> text=Retry')
    await page.waitForSelector('.bp-editor', { timeout: 20000 })
    check('Retry recovers into the blueprint editor', true)

    console.log('Project page')
    await page.goto(`${APP}/projects/${P}`)
    await page.waitForSelector('.lesson-row')
    const rows = await page.$$eval('.lesson-row', els => els.map(e => e.textContent))
    check('lessons are listed with status', rows.length === (await api('GET', L)).data.length && rows.length >= 4 && rows.some(r => /Drafted/.test(r)) && rows.some(r => /Blueprint/.test(r)), rows)
    check('drafted lessons show minutes; over-budget one is flagged', rows.some(r => /\/ 10 min/.test(r)) && rows.some(r => /over/.test(r)), rows)
    await page.click('.lesson-row >> nth=0')
    await page.waitForSelector('.lesson-page')
    check('a lesson row opens the lesson', true)

    check('no page errors', errors.length === 0, errors)
  } finally {
    await browser.close(); await env.stopEnv(mock)
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
