// Browser: the scenario renderer and generation
// Run by `npm run test:all`. Uses a mock AI model and a throwaway HOME.
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const Ajv = require(env.REPO + '/backend/node_modules/ajv')
const schema = require(env.REPO + '/backend/artifact-types/scenario-branching/schema.json')
const { promptTemplate } = require(env.REPO + '/backend/artifact-types/scenario-branching/prompt-template')
const { buildPromptContext } = require(env.REPO + '/backend/artifact-types/shared/build-prompt-context')

const env = require('../support/env')
const HOME = env.HOME
const SHOT = env.SHOT
let pass = 0, fail = 0
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS', name) } else { fail++; console.log('  FAIL', name, extra ?? '') }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(url) {
  for (let i = 0; i < 60; i++) { try { await fetch(url); return } catch { await sleep(250) } }
  throw new Error('timeout ' + url)
}

const SCENARIO = {
  learning_objective: 'Apply a changeover check before locking a schedule.',
  estimated_minutes: 4,
  setup: 'You will check changeover time before locking the schedule so the line does not stall. It is Thursday and the plan is due at noon.',
  visual_anchor_description: 'A matrix of changeover minutes between product families, with the longest cell circled.',
  start_node: 'n1',
  nodes: [
    { id: 'n1', kind: 'decision', situation: 'The draft schedule runs Product A, then B, then C. You have ten minutes. What do you check first?',
      choices: [
        { text: 'Total run hours for the week.', feedback: 'FB-N1-WEAK Run hours matter, but they hide the idle time between products.', next: 'n2', quality: 'weak' },
        { text: 'The changeover time between each pair of products.', feedback: 'FB-N1-BEST You found the real constraint, because changeover time decides the order.', next: 'n2', quality: 'best' },
        { text: 'Whether the customer orders can slip a day.', feedback: 'FB-N1-ACC That gives slack, but it costs goodwill.', next: 'e2', quality: 'acceptable' },
      ] },
    { id: 'n2', kind: 'decision', situation: 'A to B takes 90 minutes. B to C takes 20. What do you do?',
      choices: [
        { text: 'Keep the order and add a buffer.', feedback: 'FB-N2-WEAK The buffer hides the problem and the 90 minutes remain.', next: 'e2', quality: 'weak' },
        { text: 'Move B next to C and test the new order.', feedback: 'FB-N2-BEST Grouping low-changeover pairs cuts idle time.', next: 'e1', quality: 'best' },
      ] },
    { id: 'e1', kind: 'ending', situation: 'END-GOOD The new order saves 70 minutes and you lock the plan on time.' },
    { id: 'e2', kind: 'ending', situation: 'END-OK The plan locks, but the line idles. You can recover next week.' },
  ],
  apply_today: 'Next time you build a schedule, list the changeover minutes first.',
  spaced_repetition_notes: 'n2 would suit a Knowledge Check.',
}
const DANGLING = JSON.parse(JSON.stringify(SCENARIO))
DANGLING.nodes[0].choices[1].next = 'does-not-exist'
const DECK = {
  learning_objective: 'Identify the three constraints.', estimated_minutes: 3,
  visual_anchor_description: 'A diagram.', alt_text: 'A diagram of the idea', cards: [{ type: 'hook', front: 'Which binds first?', back: 'Changeover.' }],
  spaced_repetition_notes: 'None.',
}

let dangling = false
const mock = http.createServer((req, res) => {
  let raw = ''
  req.on('data', c => (raw += c))
  req.on('end', () => {
    const body = JSON.parse(raw)
    const user = body.messages[1].content
    let out = DECK
    if (/branching scenario/.test(user)) out = dangling ? DANGLING : SCENARIO
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] }))
  })
})

async function main() {
  console.log('Schema')
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema)
  check('valid scenario accepted', validate(SCENARIO), validate.errors)
  const clone = () => JSON.parse(JSON.stringify(SCENARIO))
  let bad = clone(); delete bad.nodes[0].choices
  check('decision without choices rejected', !validate(bad))
  bad = clone(); bad.nodes[0].choices = [bad.nodes[0].choices[0]]
  check('decision with 1 choice rejected', !validate(bad))
  bad = clone(); bad.nodes[0].kind = 'maybe'
  check('bad kind rejected', !validate(bad))
  bad = clone(); bad.nodes[0].choices[0].quality = 'great'
  check('bad quality rejected', !validate(bad))
  bad = clone(); delete bad.apply_today
  check('missing apply_today rejected', !validate(bad))
  check('ending node without choices is fine', validate(SCENARIO) && SCENARIO.nodes[2].choices === undefined)

  console.log('Prompt')
  const p = promptTemplate(buildPromptContext({ sourceContent: 'SRC-TEXT', context: { experience: 'Novice', learningObjectives: 'OBJ' }, project: { styleGuide: 'STYLE' } }))
  check('includes source, style guide, objective', /SRC-TEXT/.test(p) && /STYLE/.test(p) && /OBJ/.test(p))
  check('forbids giveaway wording', /no hint|may hint/i.test(p) && /recommended/.test(p))
  check('requires varied best position', /Vary the position/.test(p))
  check('no "Correct/Incorrect" feedback', /Never write "Correct,"/.test(p))
  check('under-5-minutes rule present', /under 5 minutes/.test(p))
  check('no leftover template placeholders', !/\$\{|undefined/.test(p))

  console.log('UI')
  await env.startEnv({ ui: true, mock })
  await fetch('http://127.0.0.1:3001/api/projects') // seed example
  await fetch('http://127.0.0.1:3001/api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'local', model: 'm', baseUrl: 'http://127.0.0.1:4010/v1' }),
  })

  const browser = await env.launchBrowser()
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  try {
    await page.goto('http://localhost:5173/projects/getting-started/sources/active-listening')
    await page.waitForSelector('text=Generate artifact')

    const opts = await page.$$eval('.generate-card select option', os => os.map(o => o.textContent))
    check('dropdown offers both types', opts.join('|') === 'Flip Card Deck|Scenario Branching|Knowledge Check', opts)

    // Flip deck first so we can check the mixed artifact list
    await page.click('button:has-text("✨ Generate")')
    await page.waitForSelector('.flipcard-deck')
    check('flip deck still renders', true)

    await page.selectOption('.generate-card select', 'scenario-branching')
    await page.click('button:has-text("✨ Generate")')
    await page.waitForSelector('.scenario')
    const labels = await page.$$eval('.artifact-item-type', els => els.map(e => e.textContent))
    check('artifact list labels each type', labels.includes('Scenario Branching') && labels.includes('Flip Card Deck'), labels)

    console.log('Commit-before-reveal')
    check('task/payoff shown up front', await page.isVisible('.scenario-setup'))
    check('3 choices shown', (await page.$$('.scenario-choice')).length === 3)
    let html = await page.content()
    check('NO feedback text in the page before committing', !/FB-N1/.test(html))
    check('no feedback panel before committing', (await page.$('.scenario-feedback')) === null)
    check('no ending text visible yet', !/END-GOOD|END-OK/.test(html))
    await page.screenshot({ path: path.join(SHOT, 's1-1-before-commit.png') })

    await page.click('.scenario-choice:has-text("Total run hours")')   // weak choice
    await page.waitForSelector('.scenario-feedback')
    html = await page.content()
    check('only the chosen choice feedback appears', /FB-N1-WEAK/.test(html) && !/FB-N1-BEST|FB-N1-ACC/.test(html))
    check('weak choice framed gently (accent, not red)', await page.isVisible('.scenario-feedback-weak'))
    check('all choices locked after commit', (await page.$$('.scenario-choice:disabled')).length === 3)
    check('focus moved to Continue', await page.evaluate(() => document.activeElement?.textContent?.startsWith('Continue')))
    await page.screenshot({ path: path.join(SHOT, 's1-2-after-weak.png') })

    await page.click('text=Try a different choice')
    check('retry clears feedback', (await page.$('.scenario-feedback')) === null)
    check('retry re-enables choices', (await page.$$('.scenario-choice:disabled')).length === 0)

    await page.click('.scenario-choice:has-text("changeover time between each pair")')   // best
    await page.waitForSelector('.scenario-feedback-best')
    check('best feedback shown', /FB-N1-BEST/.test(await page.content()))
    await page.click('text=Continue →')
    await page.waitForSelector('text=A to B takes 90 minutes')
    check('moves to node 2 as Decision 2', await page.isVisible('text=Decision 2'))
    check('node 2 feedback hidden until commit', !/FB-N2/.test(await page.content()))

    await page.click('.scenario-choice:has-text("Move B next to C")')   // best
    await page.click('text=Continue →')
    await page.waitForSelector('.scenario-end')
    html = await page.content()
    check('ending narration shown', /END-GOOD/.test(html))
    check('path summary lists 2 decisions', (await page.$$('.scenario-summary li')).length === 2)
    check('apply-today shown with trigger', /Next time you build a schedule/.test(html))
    await page.screenshot({ path: path.join(SHOT, 's1-3-ending.png') })

    await page.click('text=Try again from the start')
    await page.waitForSelector('text=Decision 1')
    check('restart returns to decision 1, nothing revealed', (await page.$('.scenario-feedback')) === null)

    console.log('Resilience')
    dangling = true
    await page.click('button:has-text("✨ Generate")')
    await page.waitForFunction(() => document.querySelectorAll('.artifact-item').length === 3)
    await page.click('.scenario-choice:has-text("changeover time between each pair")')   // choice whose next does not exist
    await page.click('text=Continue →')
    await page.waitForSelector('.scenario-end')
    check('dangling "next" ends gracefully', /end of this path/.test(await page.content()))
    check('apply-today still shown on dead end', await page.isVisible('.scenario-apply'))

    console.log('Other artifacts')
    await page.click('.artifact-item >> nth=2')   // oldest = flip deck
    await page.waitForSelector('.flipcard-deck')
    check('selecting the flip deck swaps the renderer back', (await page.$('.scenario')) === null)
    check('no page errors', errors.length === 0, errors)
  } finally {
    await browser.close(); await env.stopEnv(mock)
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
