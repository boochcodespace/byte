// Browser: the knowledge check renderer and generation
// Run by `npm run test:all`. Uses a mock AI model and a throwaway HOME.
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const Ajv = require(env.REPO + '/backend/node_modules/ajv')
const schema = require(env.REPO + '/backend/artifact-types/knowledge-check/schema.json')
const { promptTemplate } = require(env.REPO + '/backend/artifact-types/knowledge-check/prompt-template')
const { buildPromptContext } = require(env.REPO + '/backend/artifact-types/shared/build-prompt-context')
const { SYSTEM_PROMPT } = require(env.REPO + '/backend/artifact-types/shared/system-prompt')
const { listSupportedTypes } = require(env.REPO + '/backend/artifact-types/registry')

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

const opt = (text, correct, rationale) => ({ text, correct, rationale })
const KC = {
  learning_objective: 'Apply a changeover check before locking a schedule.',
  estimated_minutes: 4,
  setup: 'You will check changeover time before locking a schedule so the line does not stall.',
  visual_anchor_description: 'A matrix of changeover minutes with the longest cell circled.',
  apply_today: 'Next time you build a schedule, list the changeover minutes first.',
  spaced_repetition_notes: 'q2 suits a scenario.',
  items: [
    { id: 'q1', bloom_level: 'Apply', difficulty: 'intermediate', scenario: 'SCEN-Q1 The draft runs A, then B, then C.', stem: 'STEM-Q1 What do you check first?',
      options: [opt('OPT-Q1-KEY changeover time per pair', true, 'R-Q1-KEY Changeover time decides the order.'), opt('OPT-Q1-D1 total run hours for the week', false, 'R-Q1-D1 Run hours hide idle time.'), opt('OPT-Q1-D2 whether orders can slip a day', false, 'R-Q1-D2 Slack costs goodwill.')] },
    { id: 'q2', bloom_level: 'Analyze', difficulty: 'intermediate', stem: 'STEM-Q2 A to B takes 90 minutes. What do you do?',
      options: [opt('OPT-Q2-D1 add a buffer', false, 'R-Q2-D1 A buffer hides the problem.'), opt('OPT-Q2-KEY move B next to C and retest', true, 'R-Q2-KEY Grouping cuts idle time.'), opt('OPT-Q2-D2 keep the order', false, 'R-Q2-D2 The 90 minutes remain.'), opt('OPT-Q2-D3 split product B', false, 'R-Q2-D3 Splitting adds changeovers.')] },
    { id: 'q3', bloom_level: 'Apply', difficulty: 'foundation', stem: 'STEM-Q3 When do you lock the plan?',
      options: [opt('OPT-Q3-D1 before the check', false, 'R-Q3-D1 Too early.'), opt('OPT-Q3-D2 after one pass', false, 'R-Q3-D2 One pass misses retests.'), opt('OPT-Q3-KEY after the retest', true, 'R-Q3-KEY The retest confirms the saving.')] },
  ],
}
const NOKEY = JSON.parse(JSON.stringify(KC))
NOKEY.type = 'knowledge-check'
NOKEY.items = [{ id: 'n1', stem: 'STEM-NOKEY What now?', options: [opt('OPT-NK-1 one', false, 'R-NK-1 first rationale'), opt('OPT-NK-2 two', false, 'R-NK-2 second rationale'), opt('OPT-NK-3 three', false, 'R-NK-3 third rationale')] }]

const DECK = { learning_objective: 'x', estimated_minutes: 3, visual_anchor_description: 'd', alt_text: 'DECK-ALT', cards: [{ type: 'hook', front: 'f', back: 'b' }], spaced_repetition_notes: 'n' }
const mock = http.createServer((req, res) => {
  let raw = ''
  req.on('data', c => (raw += c))
  req.on('end', () => {
    const user = JSON.parse(raw).messages[1].content
    const out = /^Generate a knowledge check/.test(user) ? KC : DECK
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] }))
  })
})

async function main() {
  console.log('Registry + system prompt')
  check('backend registers 3 types', listSupportedTypes().join() === 'flip-card-deck,scenario-branching,knowledge-check', listSupportedTypes())
  check('system prompt lists knowledge-check', /knowledge-check:/.test(SYSTEM_PROMPT))
  check('system prompt names day 2, 7, 21', /day 2,\s+day 7, and day 21/.test(SYSTEM_PROMPT))
  check('old 30-second hook gone', !/30 SECONDS|first 30 seconds/i.test(SYSTEM_PROMPT))
  check('old flat 10-minute cap gone', !/10-MINUTE MAX/.test(SYSTEM_PROMPT))

  console.log('Schema')
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema)
  const clone = () => JSON.parse(JSON.stringify(KC))
  check('valid check accepted (3 and 4 option items)', validate(KC), validate.errors)
  let bad = clone(); bad.items[0].options.forEach(o => (o.correct = false))
  check('item with no correct option rejected', !validate(bad))
  bad = clone(); delete bad.items[0].options[1].rationale
  check('option without rationale rejected', !validate(bad))
  bad = clone(); bad.items[0].options = bad.items[0].options.slice(0, 2)
  check('2-option item rejected', !validate(bad))
  bad = clone(); bad.items[1].options.push(opt('extra', false, 'r'))
  check('5-option item rejected', !validate(bad))
  bad = clone(); delete bad.items
  check('missing items rejected', !validate(bad))
  bad = clone(); delete bad.apply_today
  check('missing apply_today rejected', !validate(bad))
  bad = clone(); bad.items[0].options[0].correct = 'yes'
  check('non-boolean correct rejected', !validate(bad))

  console.log('Prompt')
  const p = promptTemplate(buildPromptContext({ sourceContent: 'SRC-TEXT', context: { experience: 'Novice', learningObjectives: 'OBJ' }, project: { styleGuide: 'STYLE' } }))
  check('includes source, style guide, objective', /SRC-TEXT/.test(p) && /STYLE/.test(p) && /OBJ/.test(p))
  const mustHave = [
    ['single-best-answer only', /Single-best-answer multiple choice only/],
    ['under 120 seconds per item', /under 120 seconds/],
    ['under 5 minutes total', /under 5 minutes/],
    ['one concept per item', /exactly one concept/],
    ['self-contained stem', /stem is self-contained/],
    ['no named people', /Do not name people/],
    ['3 options default, 4 max', /3 options by default/],
    ['exactly one correct', /Exactly one option has/],
    ['distractors from source misconceptions', /real misconception/],
    ['key not longest', /must not be the longest/],
    ['no all/none of the above', /None of the above/],
    ['no absolutes', /Avoid absolutes/],
    ['rationale per option, 35 words', /maximum 35 words/],
    ['bans Correct/Incorrect/Right/Not quite', /Never write "Correct," "Incorrect," "Wrong," "Right," or "Not quite"/],
    ['no letter references in rationales', /Never refer to options by letter/],
    ['commit before rationale', /commit to an answer before any rationale/],
    ['experience levels covered', /Novice:[\s\S]*Practicing:[\s\S]*Expert:/],
    ['apply_today with trigger', /Next time X happens, do Y/],
  ]
  for (const [name, re] of mustHave) check('prompt has: ' + name, re.test(p))
  check('no leftover template placeholders', !/\$\{|undefined/.test(p))
  const texts = [...p.matchAll(/"text": "([^"]+)"/g)].map(m => m[1]).slice(0, 3) // first 3 = the few-shot options
  check('few-shot key is not the longest option', texts.length === 3 && texts[0].length <= Math.max(texts[1].length, texts[2].length) && !(texts[0].length > texts[1].length && texts[0].length > texts[2].length), texts.map(t => t.length))
  check('few-shot uses no personal names', !/Aisha|Raj|Bob|Sarah|Maria/.test(p))
  check('few-shot rationales avoid option letters', !/\b(option|answer) [ABCD]\b/.test(p))

  console.log('UI')
  await env.startEnv({ ui: true, mock })
  await fetch('http://127.0.0.1:3001/api/projects')
  await fetch('http://127.0.0.1:3001/api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'local', model: 'm', baseUrl: 'http://127.0.0.1:4010/v1' }),
  })
  const artDir = path.join(HOME, 'Byte', 'projects', 'getting-started', 'sources', 'active-listening', 'artifacts', 'knowledge-check-1')
  fs.mkdirSync(artDir, { recursive: true })
  fs.writeFileSync(path.join(artDir, 'artifact.json'), JSON.stringify(NOKEY))

  const browser = await env.launchBrowser()
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  const keyPos = () => page.$$eval('.kc-option', els => els.findIndex(e => e.textContent.includes('OPT-Q1-KEY')))
  try {
    await page.goto('http://localhost:5173/projects/getting-started/sources/active-listening')
    await page.waitForSelector('text=Generate artifact')
    const opts = await page.$$eval('.generate-card select option', os => os.map(o => o.textContent))
    check('dropdown offers all 3 types', opts.join('|') === 'Flip Card Deck|Scenario Branching|Knowledge Check', opts)

    await page.selectOption('.generate-card select', 'knowledge-check')
    await page.click('button:has-text("✨ Generate")')
    // The injected malformed artifact is auto-selected on load, so wait for the GENERATED one
    await page.waitForSelector('text=Question 1 of 3')
    // Generated one is selected after generation
    const labels = await page.$$eval('.artifact-item-type', els => els.map(e => e.textContent))
    check('artifact list shows Knowledge Check label', labels.every(l => l === 'Knowledge Check') && labels.length === 2, labels)

    console.log('Commit-before-reveal')
    check('task + payoff shown up front', await page.isVisible('.kc-setup'))
    check('shows "Question 1 of 3"', await page.isVisible('text=Question 1 of 3'))
    check('scenario and stem shown', await page.isVisible('text=SCEN-Q1') && await page.isVisible('text=STEM-Q1'))
    check('3 options with letters A-C', (await page.$$eval('.kc-letter', els => els.map(e => e.textContent).join(''))) === 'ABC')
    let html = await page.content()
    check('NO rationale text in the page before committing', !/R-Q1-/.test(html))
    check('no feedback panel before committing', (await page.$('.kc-feedback')) === null)
    await page.screenshot({ path: path.join(SHOT, 'kc-1-before.png') })

    await page.click('.kc-option:has-text("OPT-Q1-D1")')   // a weaker answer
    await page.waitForSelector('.kc-feedback')
    html = await page.content()
    check('chosen distractor rationale shown', /R-Q1-D1/.test(html))
    check('strongest answer + its rationale revealed', /R-Q1-KEY/.test(html) && /The strongest answer/.test(html))
    check('the OTHER distractor rationale is never shown', !/R-Q1-D2/.test(html))
    check('weak answer framed gently (accent, not red)', await page.isVisible('.kc-feedback-weaker'))
    check('all options locked after commit', (await page.$$('.kc-option:disabled')).length === 3)
    check('focus moved to Next', await page.evaluate(() => document.activeElement?.textContent?.startsWith('Next question')))
    const chrome = await page.textContent('.kc')
    check('no "Correct/Incorrect/Wrong/Not quite" in the UI', !/\b(Correct|Incorrect|Wrong|Not quite)\b/.test(chrome.replace(/R-[A-Z0-9-]+[^.]*\./g, '')))
    await page.screenshot({ path: path.join(SHOT, 'kc-2-after-weaker.png') })

    await page.click('text=Next question →')
    await page.waitForSelector('text=Question 2 of 3')
    check('Q2 has 4 options', (await page.$$('.kc-option')).length === 4)
    check('Q2 rationales hidden until commit', !/R-Q2-/.test(await page.content()))
    await page.click('.kc-option:has-text("OPT-Q2-KEY")')
    await page.waitForSelector('.kc-feedback-strong')
    check('strongest answer: only its own rationale, no extra key panel', /R-Q2-KEY/.test(await page.content()) && (await page.$('.kc-key')) === null)
    await page.click('text=Next question →')
    await page.waitForSelector('text=Question 3 of 3')
    await page.click('.kc-option:has-text("OPT-Q3-KEY")')
    check('last question button says "See results"', await page.isVisible('text=See results →'))
    await page.click('text=See results →')
    await page.waitForSelector('.kc-end')
    check('results: 2 of 3 strongest', await page.isVisible('text=strongest answer on 2 of 3 questions'))
    check('results list 3 answers', (await page.$$('.kc-summary li')).length === 3)
    check('apply-today shown with trigger', /Next time you build a schedule/.test(await page.content()))
    await page.screenshot({ path: path.join(SHOT, 'kc-3-results.png') })

    console.log('Answer positions are shuffled')
    const positions = new Set()
    for (let t = 0; t < 14; t++) {
      await page.click('text=Try again from the start')
      await page.waitForSelector('text=Question 1 of 3')
      positions.add(await keyPos())
      for (let q = 0; q < 3; q++) {
        await page.click('.kc-option >> nth=0')
        await page.click(q === 2 ? 'text=See results →' : 'text=Next question →')
      }
      await page.waitForSelector('.kc-end')
    }
    check('correct answer appears in more than one position across 14 attempts', positions.size > 1, [...positions])
    check('restart returns to Q1 with nothing revealed', (await (async () => { await page.click('text=Try again from the start'); await page.waitForSelector('text=Question 1 of 3'); return (await page.$('.kc-feedback')) === null })()))

    console.log('Malformed item (no option flagged correct)')
    const items = await page.$$('.artifact-item')
    for (const it of items) {
      await it.click()
      if (await page.isVisible('text=STEM-NOKEY').catch(() => false)) break
    }
    await page.waitForSelector('text=STEM-NOKEY')
    await page.click('.kc-option >> nth=1')
    await page.waitForSelector('.kc-feedback')
    html = await page.content()
    check('shows the chosen option rationale', /R-NK-/.test(html))
    check('no "strongest answer" panel when none is flagged', (await page.$('.kc-key')) === null)
    check('still offers a way forward', await page.isVisible('text=See results →'))

    console.log('Regression')
    await page.selectOption('.generate-card select', 'flip-card-deck')
    await page.click('button:has-text("✨ Generate")')
    await page.waitForSelector('.flipcard-deck')
    check('flip deck generates and renders', true)
    check('no page errors', errors.length === 0, errors)
  } finally {
    await browser.close(); await env.stopEnv(mock)
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
