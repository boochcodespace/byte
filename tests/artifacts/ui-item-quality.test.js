// Browser: item quality, option shuffling, names policy, and scenario defaults
// Run by `npm run test:all`. Uses a mock AI model and a throwaway HOME.
const env = require('../support/env')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const B = env.REPO + '/backend/artifact-types'
const { SYSTEM_PROMPT } = require(`${B}/shared/system-prompt`)
const scenario = require(`${B}/scenario-branching/prompt-template`)
const flip = require(`${B}/flip-card-deck/prompt-template`)
const kc = require(`${B}/knowledge-check/prompt-template`)
const { buildPromptContext } = require(`${B}/shared/build-prompt-context`)

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
const ctx = buildPromptContext({ sourceContent: 'SRC-TEXT', context: { experience: 'Practicing' }, project: { styleGuide: 'STYLE' } })
const NAMES = /\b(Aisha|Raj|Mei-Lin|Kwame|Sofia|Bob|Kathryn|Maria|Sarah)\b/

const SCEN = {
  learning_objective: 'Apply a changeover check.', estimated_minutes: 4, setup: 'You will check changeover time so the line does not stall.',
  start_node: 'n1', apply_today: 'Next time you build a schedule, list changeover minutes first.',
  nodes: [
    { id: 'n1', kind: 'decision', situation: 'SIT-1 What do you check first?', choices: [
      { text: 'CH-A run hours', feedback: 'FB-A', next: 'e1', quality: 'weak' },
      { text: 'CH-B changeover per pair', feedback: 'FB-B', next: 'e1', quality: 'best' },
      { text: 'CH-C order slack', feedback: 'FB-C', next: 'e1', quality: 'acceptable' } ] },
    { id: 'e1', kind: 'ending', situation: 'END done' },
  ],
}
let lastPrompt = ''
const mock = http.createServer((req, res) => {
  let raw = ''
  req.on('data', c => (raw += c))
  req.on('end', () => {
    lastPrompt = JSON.parse(raw).messages[1].content
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(SCEN) } }] }))
  })
})

async function main() {
  console.log('System prompt: names')
  const rajCount = (SYSTEM_PROMPT.match(/Raj/g) || []).length
  check('name pool appears once', rajCount === 1, rajCount)
  const nameSentence = SYSTEM_PROMPT.split('\n\n').find(par => /Raj/.test(par)) || ''
  check('name pool is inside the "explicitly asks" condition', /PROJECT STYLE GUIDE explicitly asks/.test(nameSentence.replace(/\s+/g, ' ')), nameSentence)
  check('default: second person, no invented characters', /Do not invent named\s+characters/.test(SYSTEM_PROMPT) && /write to the learner as "you"/.test(SYSTEM_PROMPT))
  check('old unconditional "Diverse names in examples" rule is gone', !/Diverse names in examples/.test(SYSTEM_PROMPT))

  console.log('System prompt: item-writing rules (apply to every question type)')
  const norm = SYSTEM_PROMPT.replace(/\s+/g, ' ')
  for (const [name, re] of [
    ['section covers all four question kinds', /ITEM WRITING RULES These rules apply to every question Byte writes: knowledge check items, scenario decision points, flip card fronts, and recall prompts/],
    ['one concept per item', /One concept per item/],
    ['self-contained stem, positive phrasing', /Self-contained stem[\s\S]*positive phrasing and no double negatives/],
    ['no "best" alone', /Do not use "best" alone/],
    ['distractors from real mistakes', /Build every wrong option from a real mistake/],
    ['key never longest', /correct option is never the longest or most detailed/],
    ['no all/none/combined', /No "all of the above," "none of the above," or combined answers/],
    ['absolutes rule', /No absolutes/],
    ['vary position', /Vary where the correct option appears/],
    ['consequence-based feedback', /Consequence-based feedback/],
    ['bans Correct/Wrong/Right/Not quite', /Never write "Correct," "Incorrect," "Wrong," "Right," or "Not quite\."/],
    ['no letter/position references', /Never point to options by letter or position/],
    ['recall prompts stand alone', /Recall prompts \(day 2, 7, and 21\)\. Each one stands alone/],
  ]) check('has: ' + name, re.test(norm))

  console.log('Scenario prompt: decision-count parameter')
  const R = scenario.resolveDecisionRange
  const eq = (a, b) => a.min === b.min && a.max === b.max
  check('default is 3 to 5', eq(R({}), { min: 3, max: 5 }) && eq(R(undefined), { min: 3, max: 5 }))
  check('lesson range 2 to 3', eq(R({ minDecisions: 2, maxDecisions: 3 }), { min: 2, max: 3 }))
  check('string numbers accepted', eq(R({ minDecisions: '2', maxDecisions: '3' }), { min: 2, max: 3 }))
  check('too high clamps to 5', eq(R({ minDecisions: 3, maxDecisions: 99 }), { min: 3, max: 5 }))
  check('too low clamps to 2', eq(R({ minDecisions: 0, maxDecisions: 3 }), { min: 2, max: 3 }))
  check('junk falls back to defaults', eq(R({ minDecisions: 'x', maxDecisions: null }), { min: 3, max: 5 }))
  check('max only: min never exceeds it', eq(R({ maxDecisions: 2 }), { min: 2, max: 2 }))
  check('min above max is pulled down', eq(R({ minDecisions: 5, maxDecisions: 3 }), { min: 3, max: 3 }))
  const pDefault = scenario.promptTemplate(ctx)
  const pLesson = scenario.promptTemplate(ctx, { minDecisions: 2, maxDecisions: 3 })
  const pExact = scenario.promptTemplate(ctx, { minDecisions: 3, maxDecisions: 3 })
  check('default prompt: 3 to 5 decisions, 5 to 8 nodes', /- 3 to 5 decision points/.test(pDefault) && /- 5 to 8 nodes/.test(pDefault))
  check('lesson prompt: 2 to 3 decisions, 4 to 6 nodes', /- 2 to 3 decision points/.test(pLesson) && /- 4 to 6 nodes/.test(pLesson))
  check('exact prompt: "exactly 3"', /- exactly 3 decision points/.test(pExact))

  console.log('Scenario prompt: decision design')
  for (const [name, re] of [
    ['best choice not obvious', /best choice must NOT be obvious/],
    ['tempting distractor', /what a capable person under pressure would actually do/],
    ['distractors from source mistakes', /realistic mistake, misconception/],
    ['match length/tone, best not longest', /best choice\s+must not be the longest/],
    ['best not the only careful-sounding one', /only\s+choice that sounds careful, patient, or collaborative/],
    ['no giveaway words', /No "obviously," no "recommended,"/],
    ['mutually exclusive, no all/none/and-bundles', /mutually exclusive[\s\S]*bundles two actions/],
    ['vary best position', /Vary the position of the best choice/],
    ['consequence-based feedback', /consequence-based: say what happens next/],
    ['bans Correct/Wrong/Right/Not quite', /Never write "Correct," "Incorrect," "Wrong," "Right," or "Not quite\."/],
    ['no letter/position references', /Never refer to choices by letter or position/],
    ['no named people unless style guide asks', /Do not name people[\s\S]*PROJECT STYLE GUIDE explicitly asks/],
  ]) check('has: ' + name, re.test(pDefault.replace(/\s+/g, ' ').replace(/\s+/g, ' ')) || re.test(pDefault), name)
  check('few-shot has no personal names', !NAMES.test(pDefault))
  check('few-shot uses second person/role', /A teammate tells you they are stuck/.test(pDefault))
  const fs1 = pDefault.slice(pDefault.indexOf('FEW-SHOT'))
  const choiceTexts = [...fs1.matchAll(/"text": "([^"]+)"/g)].map(m => m[1]).slice(0, 2)
  const qualities = [...fs1.matchAll(/"quality": "(\w+)"/g)].map(m => m[1]).slice(0, 2)
  const bestIdx = qualities.indexOf('best')
  check('few-shot best choice is not the longest', choiceTexts[bestIdx].length <= choiceTexts[1 - bestIdx].length, choiceTexts.map(t => t.length))
  check('few-shot does not put the best choice first', bestIdx === 1, qualities)
  check('no leftover placeholders', !/\$\{|undefined/.test(pDefault + pLesson))

  console.log('Flip + knowledge check prompts')
  const pFlip = flip.promptTemplate(ctx)
  const pKc = kc.promptTemplate(ctx)
  const nf = pFlip.replace(/\s+/g, ' ')
  check('flip: complete question a prepared learner could answer', /complete, focused question or decision point that a prepared learner could answer from memory/.test(nf))
  check('flip: positive phrasing, no "best" alone', /positive phrasing, no double negatives, and never "best" alone/.test(nf))
  check('flip: front must not give the answer away', /front must not give the answer away[\s\S]*Do not repeat distinctive words from the back/.test(nf))
  check('flip: no names unless style guide asks', /do not name people unless the PROJECT STYLE GUIDE explicitly asks/i.test(nf))
  check('flip: no names in few-shot', !NAMES.test(pFlip))
  check('kc: names only if style guide asks', /unless the PROJECT STYLE GUIDE explicitly asks for named characters/.test(pKc.replace(/\s+/g, ' ')))
  check('kc: no names in few-shot', !NAMES.test(pKc))

  console.log('Decision count via the HTTP route')
  await env.startEnv({ ui: true, mock })
  const api = (m, p, b) => fetch('http://127.0.0.1:3001/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json())
  await api('GET', '/projects')
  await api('POST', '/settings', { provider: 'local', model: 'm', baseUrl: 'http://127.0.0.1:4010/v1' })
  const GEN = '/projects/getting-started/sources/active-listening/artifacts/generate'
  let r = await api('POST', GEN, { artifactType: 'scenario-branching' })
  check('route: no params → 3 to 5 decisions', r.ok === true && /- 3 to 5 decision points/.test(lastPrompt), r)
  r = await api('POST', GEN, { artifactType: 'scenario-branching', minDecisions: 2, maxDecisions: 3 })
  check('route: lesson params reach the prompt (2 to 3)', r.ok === true && /- 2 to 3 decision points/.test(lastPrompt))
  r = await api('POST', GEN, { artifactType: 'scenario-branching', maxDecisions: 999 })
  check('route: out-of-range param is clamped, not rejected', r.ok === true && /- 3 to 5 decision points/.test(lastPrompt))

  console.log('Scenario UI: shuffled choices')
  const browser = await env.launchBrowser()
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  try {
    await page.goto('http://localhost:5173/projects/getting-started/sources/active-listening')
    await page.waitForSelector('.scenario')
    const texts = () => page.$$eval('.scenario-choice', els => els.map(e => e.textContent))
    const bestPos = async () => (await texts()).findIndex(t => t.includes('CH-B'))
    const positions = new Set()
    for (let t = 0; t < 14; t++) {
      positions.add(await bestPos())
      await page.click('.scenario-choice:has-text("CH-B")')
      await page.click('text=Continue →')
      await page.waitForSelector('.scenario-end')
      await page.click('text=Try again from the start')
      await page.waitForSelector('.scenario-choice')
    }
    check('best choice appears in more than one position across 14 attempts', positions.size > 1, [...positions])

    const before = await texts()
    await page.click('.scenario-choice:has-text("CH-A")')
    await page.waitForSelector('.scenario-feedback')
    check('feedback matches the clicked choice even when shuffled', /FB-A/.test(await page.content()) && !/FB-B|FB-C/.test(await page.content()))
    await page.click('text=Try a different choice')
    check('order stays stable on "Try a different choice"', JSON.stringify(await texts()) === JSON.stringify(before))
    await page.click('.scenario-choice:has-text("CH-B")')
    await page.waitForSelector('.scenario-feedback-best')
    check('picking the best choice still reads as best', /FB-B/.test(await page.content()))
    check('feedback has no letter references', !/\b(option|choice) [ABC]\b/.test(await page.textContent('.scenario-feedback')))
    await page.screenshot({ path: path.join(SHOT, 'b-1-shuffled.png') })
    check('no page errors', errors.length === 0, errors)
  } finally {
    await browser.close(); await env.stopEnv(mock)
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
