// API: the lesson workflow (blueprint, text, artifacts, tabs, insert, remove, context) and the standalone generation limits
// Run by `npm run test:all`. Uses a mock AI model and a throwaway HOME.
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const env = require('../support/env')
const HOME = env.HOME
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

// ── fixtures ───────────────────────────────────────────────────────
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

// ── mock model ─────────────────────────────────────────────────────
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
      if (mode === 'text_recall_no_answer') delete out.blocks[5].answer
      const tabsP = { after_section: 's2', artifact_type: 'tabs', note: 'NOTE-TABS compare host, client, and server.' }
      if (mode === 'text_with_tabs') out.placements = [...PLACEMENTS, tabsP]
      if (mode === 'text_five_placements') out.placements = [...PLACEMENTS, tabsP, { after_section: 's1', artifact_type: 'flip-card-deck', note: 'dup' }]
      if (mode === 'text_tabs_only') out.placements = [tabsP]
    } else if (/^Write a tabs block/.test(user)) {
      // n tabs (or 3), 40-word bodies; echo any focus into the title so a test can see it arrive
      const n = Number((user.match(/Exactly (\d) tabs/) || [])[1]) || 3
      const f = user.match(/^Focus: (.*)$/m)
      out = {
        title: f ? `Tabs :: ${f[1]}` : 'Roles at a glance',
        tabs: Array.from({ length: n }, (_, i) => ({ label: `Tab${i + 1}`, body: `TABBODY${i + 1} ${para(39)}`, ...(i === 0 ? { visual: 'TAB-VISUAL a diagram', alt_text: 'TAB-ALT diagram' } : {}) })),
      }
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

async function main() {
  await env.startEnv({ ui: false, mock })
  try {
    await api('GET', '/projects') // seeds getting-started / active-listening
    await api('POST', '/settings', { provider: 'local', model: 'm', baseUrl: `${MOCK}/v1` })
    await api('PUT', `/projects/${P}`, { styleGuide: 'STYLE-X use short words' })
    await api('PUT', `/projects/${P}/sources/${PRIMARY}`, { context: { role: 'Team Lead', experience: 'Intermediate', useCase: 'Run better 1:1s', learningObjectives: 'OBJ-SRC practice listening' } })
    const s2 = await api('POST', `/projects/${P}/sources`, { title: 'Second Source', content: '# Second Source\n\nSECOND-SOURCE-TEXT changeover matrix details.' })
    check('second source created', s2.ok === true && s2.data.slug === SECOND, s2)

    console.log('maxCards / maxItems parameters')
    const GEN = `/projects/${P}/sources/${PRIMARY}/artifacts/generate`
    await api('POST', GEN, { artifactType: 'flip-card-deck' })
    check('flip default sizing unchanged', /- 6 to 10 cards when source is rich/.test(lastPrompt()) && /- 4 to 6 cards when source is thin/.test(lastPrompt()))
    await sleep(5)
    await api('POST', GEN, { artifactType: 'flip-card-deck', maxCards: 4 })
    check('flip maxCards 4 → "At most 4 cards"', /At most 4 cards in total: one HOOK card, one APPLY card/.test(lastPrompt().replace(/\s+/g, ' ')) && !/6 to 10 cards/.test(lastPrompt()))
    await sleep(5)
    await api('POST', GEN, { artifactType: 'flip-card-deck', maxCards: 99 })
    check('flip maxCards clamps to 10', /At most 10 cards/.test(lastPrompt()))
    await sleep(5)
    await api('POST', GEN, { artifactType: 'flip-card-deck', maxCards: 'x' })
    check('flip junk maxCards falls back to default', /6 to 10 cards when source is rich/.test(lastPrompt()))
    await sleep(5)
    await api('POST', GEN, { artifactType: 'knowledge-check' })
    check('kc default sizing unchanged', /- 4 to 6 items when the source is rich/.test(lastPrompt()) && /- 3 to 4 items when the source is thin/.test(lastPrompt()))
    await sleep(5)
    await api('POST', GEN, { artifactType: 'knowledge-check', maxItems: 3 })
    check('kc maxItems 3 → "At most 3 items"', /At most 3 items/.test(lastPrompt()) && !/4 to 6 items/.test(lastPrompt()))
    await sleep(5)
    await api('POST', GEN, { artifactType: 'knowledge-check', maxItems: 0 })
    check('kc maxItems clamps up to 2', /At most 2 items/.test(lastPrompt()))
    await sleep(5)
    await api('POST', GEN, { artifactType: 'scenario-branching', minDecisions: 2, maxDecisions: 2 })
    check('scenario 2 decisions → "exactly 2"', /- exactly 2 decision points/.test(lastPrompt()))
    await sleep(5)
    await api('POST', `/projects/${P}/sources/${SECOND}/artifacts/generate`, { artifactType: 'knowledge-check' })

    console.log('Project artifact list')
    check('unknown project → not_found', (await api('GET', '/projects/nope/artifacts')).errorType === 'not_found')
    let list = (await api('GET', `/projects/${P}/artifacts`)).data
    check('lists artifacts from every source', list.some(a => a.source === PRIMARY) && list.some(a => a.source === SECOND), list.map(a => a.source))
    check('newest first', list.every((a, i) => i === 0 || list[i - 1].createdAt >= a.createdAt))
    check('newest is the second source KC', list[0].source === SECOND && list[0].type === 'knowledge-check', list[0])
    check('entries carry source title, type, objective', list.every(a => a.sourceTitle && a.type && a.folder) && list.find(a => a.type === 'knowledge-check').title === 'KC-OBJ')
    const kcOnly = (await api('GET', `/projects/${P}/artifacts?type=knowledge-check`)).data
    check('type filter works', kcOnly.length > 0 && kcOnly.every(a => a.type === 'knowledge-check') && kcOnly.length < list.length)
    const oldDir = artifactPath(PRIMARY, 'flip-cards-1700000000000')
    fs.mkdirSync(oldDir, { recursive: true })
    fs.writeFileSync(path.join(oldDir, 'artifact.json'), JSON.stringify({ learning_objective: 'OLD', cards: [] }))
    const badDir = artifactPath(PRIMARY, 'knowledge-check-1')
    fs.mkdirSync(badDir, { recursive: true })
    fs.writeFileSync(path.join(badDir, 'artifact.json'), '{ not json')
    list = (await api('GET', `/projects/${P}/artifacts`)).data
    const old = list.find(a => a.folder === 'flip-cards-1700000000000')
    check('old untyped artifact listed as flip-card-deck, dated from its folder', old && old.type === 'flip-card-deck' && old.createdAt === 1700000000000, old)
    check('unreadable artifact is skipped', !list.some(a => a.folder === 'knowledge-check-1'))
    check('unreadable artifact is NOT deleted', fs.existsSync(path.join(badDir, 'artifact.json')))

    console.log('Create lesson')
    check('topic required', (await api('POST', L, { sources: [PRIMARY] })).errorType === 'validation')
    check('source required', (await api('POST', L, { topic: 'T' })).errorType === 'validation')
    check('unknown source → not_found', (await api('POST', L, { topic: 'T', sources: ['nope'] })).errorType === 'not_found')
    check('duplicate source rejected', (await api('POST', L, { topic: 'T', sources: [PRIMARY, PRIMARY] })).errorType === 'validation')
    await api('POST', `/projects/${P}/sources`, { title: 'Huge', content: '# Huge\n\n' + 'x'.repeat(45000) })
    const big = await api('POST', L, { topic: 'T', sources: [PRIMARY, 'huge'] })
    check('over 40,000 characters → friendly "pick fewer sources"', big.errorType === 'validation' && /Pick fewer sources/.test(big.userMessage) && /40,000/.test(big.userMessage), big)
    const created = await api('POST', L, { topic: 'Check changeover', sources: [PRIMARY, SECOND], perGenerationPrompt: 'PERGEN-X' })
    const lesson1 = created.data.lesson
    check('lesson created in "blueprint" status with no blueprint yet', created.ok && lesson1.status === 'blueprint' && lesson1.blueprint === null && lesson1.blocks.length === 0, created)
    check('primary source is the first one picked', lesson1.sources[0] === PRIMARY && lesson1.sources[1] === SECOND)
    check('context prefilled from primary source (experience normalized)', JSON.stringify(lesson1.context) === JSON.stringify({ role: 'Team Lead', experience: 'Practicing', useCase: 'Run better 1:1s', learningObjectives: 'OBJ-SRC practice listening' }), lesson1.context)
    check('default budget 10', lesson1.time_budget_minutes === 10)
    check('budget clamps to 5..10', (await api('POST', L, { topic: 'a', sources: [PRIMARY], timeBudgetMinutes: 99 })).data.lesson.time_budget_minutes === 10 && (await api('POST', L, { topic: 'b', sources: [PRIMARY], timeBudgetMinutes: 1 })).data.lesson.time_budget_minutes === 5)
    check('lesson list shows it', (await api('GET', L)).data.some(l => l.id === lesson1.id && l.status === 'blueprint'))
    check('unknown lesson → not_found', (await api('GET', `${L}/nope`)).errorType === 'not_found')
    check('unsafe lesson id → not_found', (await api('GET', `${L}/a..b`)).errorType === 'not_found')

    console.log('Blueprint generation')
    const id1 = lesson1.id
    check('text before approval refused', (await api('POST', `${L}/${id1}/text/generate`)).errorType === 'validation')
    check('approve before a blueprint exists refused', (await api('PUT', `${L}/${id1}/blueprint`, { approve: true })).errorType === 'validation')
    mode = 'bp_missing_day21'
    let r = await api('POST', `${L}/${id1}/blueprint/generate`)
    check('blueprint missing day 21 recall → schema_validation', r.ok === false && r.errorType === 'schema_validation', r)
    check('failed generation leaves the lesson untouched', (await api('GET', `${L}/${id1}`)).data.lesson.blueprint === null)
    mode = 'notjson'
    r = await api('POST', `${L}/${id1}/blueprint/generate`)
    check('non-JSON output → malformed_json', r.errorType === 'malformed_json')
    mode = 'bp_shuffled'
    r = await api('POST', `${L}/${id1}/blueprint/generate`)
    const secs = r.data.lesson.blueprint.sections
    check('sections reordered: hook, chunks, apply, recall by day', secs.map(s => s.kind).join() === 'hook,chunk,chunk,chunk,apply,recall,recall,recall' && secs.filter(s => s.kind === 'recall').map(s => s.recall_day).join() === '2,7,21', secs.map(s => s.kind + (s.recall_day || '')))
    check('ids reassigned s1..s8 in order', secs.map(s => s.id).join() === 's1,s2,s3,s4,s5,s6,s7,s8')
    mode = 'ok'
    r = await api('POST', `${L}/${id1}/blueprint/generate`)
    const bp = r.data.lesson
    check('blueprint saved with objective', r.ok && bp.objective.startsWith('Apply a changeover check') && bp.blueprint.sections.length === 8 && bp.status === 'blueprint')
    check('unknown source refs filtered out', bp.blueprint.sections[3].source_refs.length === 0 && bp.blueprint.sections[2].source_refs.join() === `${PRIMARY},${SECOND}`)
    const bpPrompt = prompts.filter(p => /^Plan a lesson blueprint/.test(p)).pop()
    check('prompt carries topic, both sources, headers with ids', /LESSON TOPIC ═══\nCheck changeover/.test(bpPrompt) && /SECOND-SOURCE-TEXT/.test(bpPrompt) && new RegExp(`\\(id: ${SECOND}\\)`).test(bpPrompt) && new RegExp(`\\(id: ${PRIMARY}\\)`).test(bpPrompt))
    check('prompt carries prefilled learner context', /Role: Team Lead/.test(bpPrompt) && /Experience level: Practicing/.test(bpPrompt) && /OBJ-SRC practice listening/.test(bpPrompt))
    check('prompt carries all three steering layers', /STYLE-X/.test(bpPrompt) && /PERGEN-X/.test(bpPrompt) && /PROJECT CUSTOM INSTRUCTIONS/.test(bpPrompt))
    check('prompt sets the text budget to 40% of 10 minutes', /at most 4 minutes/.test(bpPrompt.replace(/\s+/g, ' ')) && /10 minutes or less/.test(bpPrompt))
    check('prompt asks for question-style chunk titles "where natural"', /Phrase a chunk title as a question where that reads naturally/.test(bpPrompt.replace(/\s+/g, ' ')))
    check('prompt requires recall days 2, 7, 21', /recall_day 2, 7, and 21/.test(bpPrompt))

    console.log('Blueprint editing + approval')
    r = await api('PUT', `${L}/${id1}/blueprint`, { objective: 'Edited objective', title: 'Edited title', sections: bp.blueprint.sections.map(s => s.id === 's2' ? { id: 's2', title: 'EDITED-TITLE-2', purpose: 'Edited purpose', target_minutes: 1.2 } : { id: s.id }) })
    const e = r.data.lesson
    check('edits saved', r.ok && e.objective === 'Edited objective' && e.title === 'Edited title' && e.blueprint.sections[1].title === 'EDITED-TITLE-2' && e.blueprint.sections[1].target_minutes === 1.2, r)
    check('untouched sections keep their content', e.blueprint.sections[0].title === 'Why check changeover first?')
    check('unknown section id rejected', (await api('PUT', `${L}/${id1}/blueprint`, { sections: [{ id: 'zzz' }] })).errorType === 'validation')
    check('duplicate section rejected', (await api('PUT', `${L}/${id1}/blueprint`, { sections: [{ id: 's1' }, { id: 's1' }] })).errorType === 'validation')
    check('cannot remove the hook', (await api('PUT', `${L}/${id1}/blueprint`, { sections: e.blueprint.sections.filter(s => s.kind !== 'hook').map(s => ({ id: s.id })) })).errorType === 'validation')
    check('non-numeric minutes rejected', (await api('PUT', `${L}/${id1}/blueprint`, { sections: [{ id: 's1', target_minutes: 'abc' }, ...e.blueprint.sections.slice(1).map(s => ({ id: s.id }))] })).errorType === 'validation')
    r = await api('PUT', `${L}/${id1}/blueprint`, { context: { role: 'Planner', experience: 'Expert' } })
    check('context editable (experience normalized)', r.data.lesson.context.role === 'Planner' && r.data.lesson.context.experience === 'Expert' && r.data.lesson.context.useCase === 'Run better 1:1s')
    r = await api('PUT', `${L}/${id1}/blueprint`, { context: { experience: 'weird' } })
    check('unknown experience becomes blank', r.data.lesson.context.experience === '')
    await api('PUT', `${L}/${id1}/blueprint`, { context: { experience: 'Practicing' } })
    r = await api('PUT', `${L}/${id1}/blueprint`, { sections: e.blueprint.sections.filter(s => s.id !== 's4').map(s => ({ id: s.id })) })
    check('a chunk can be removed (original order kept)', r.data.lesson.blueprint.sections.map(s => s.id).join() === 's1,s2,s3,s5,s6,s7,s8', r.data?.lesson?.blueprint?.sections?.map(s => s.id))
    r = await api('PUT', `${L}/${id1}/blueprint`, { approve: true })
    check('approve sets status "approved"', r.data.lesson.status === 'approved')
    r = await api('PUT', `${L}/${id1}/blueprint`, { objective: 'Changed after approval' })
    check('editing after approval returns it to "blueprint"', r.data.lesson.status === 'blueprint')
    await api('PUT', `${L}/${id1}/blueprint`, { objective: 'Edited objective', approve: true })

    console.log('Text generation')
    mode = 'text_missing_block'
    r = await api('POST', `${L}/${id1}/text/generate`)
    check('missing block for a section → schema_validation', r.errorType === 'schema_validation', r)
    mode = 'text_no_retrieval'
    r = await api('POST', `${L}/${id1}/text/generate`)
    check('no knowledge-check/scenario proposed → schema_validation (hard rule)', r.errorType === 'schema_validation', r)
    mode = 'text_chunk_no_visual'
    check('chunk without a visual → schema_validation', (await api('POST', `${L}/${id1}/text/generate`)).errorType === 'schema_validation')
    mode = 'text_recall_no_answer'
    check('recall without an answer → schema_validation', (await api('POST', `${L}/${id1}/text/generate`)).errorType === 'schema_validation')
    check('failed text generation leaves the lesson approved with no blocks', (await api('GET', `${L}/${id1}`)).data.lesson.status === 'approved' && (await api('GET', `${L}/${id1}`)).data.lesson.blocks.length === 0)
    mode = 'ok'
    r = await api('POST', `${L}/${id1}/text/generate`)
    const les = r.data.lesson
    check('text generated, status "drafted"', r.ok && les.status === 'drafted', r)
    const textPrompt = prompts.filter(p => /^Write the text of a lesson/.test(p)).pop()
    check('prompt has the approved blueprint, locked objective, steering', /APPROVED BLUEPRINT/.test(textPrompt) && /EDITED-TITLE-2/.test(textPrompt) && /LESSON OBJECTIVE \(locked\)\n\nEdited objective|LESSON OBJECTIVE \(locked\) ═══\nEdited objective/.test(textPrompt) && /STYLE-X/.test(textPrompt))
    check('prompt requires one retrieval artifact and states remaining time', /MUST propose at least one knowledge-check or scenario-branching/.test(textPrompt.replace(/\s+/g, ' ')) && /minutes remain for artifacts/.test(textPrompt))
    check('prompt keeps names off by default', /Do not name people unless/.test(textPrompt.replace(/\s+/g, ' ')))
    const kinds = les.blocks.map(b => b.kind + (b.artifact_type ? `:${b.artifact_type}` : ''))
    check('block order: text with proposals after their section, recall last', kinds.join() === 'hook,chunk,artifact:flip-card-deck,chunk,artifact:knowledge-check,apply,artifact:scenario-branching,recall,recall,recall', kinds)
    check('removed-section placement falls back to the last text block', les.blocks[6].artifact_type === 'scenario-branching' && les.blocks[5].kind === 'apply')
    check('block ids unique and sequential', les.blocks.map(b => b.id).join() === les.blocks.map((_, i) => `b${i + 1}`).join())
    check('titles come from the (edited) blueprint', les.blocks[1].title === 'EDITED-TITLE-2')
    check('chunks carry a visual; recall carries answer and day', les.blocks[1].visual.startsWith('VISUAL-2') && les.blocks[7].answer.startsWith('ANSWER-2') && les.blocks[7].recall_day === 2 && les.blocks[9].recall_day === 21)
    check('source refs filtered to the lesson sources', les.blocks[1].source_refs.join() === PRIMARY)
    check('edited flag present and false on text blocks', les.blocks.filter(b => b.kind !== 'artifact').every(b => b.edited === false))
    const prop = les.blocks[4]
    check('proposals have state, note, and no ref', prop.state === 'proposed' && prop.ref === null && /NOTE-KC/.test(prop.placement_note))
    check('proposals are NOT generated (no artifacts resolved)', Object.keys(r.data.artifacts).length === 0)
    const nonRecall = les.blocks.filter(b => b.kind !== 'recall')
    check('every block has computed minutes', les.blocks.every(b => typeof b.minutes === 'number' && b.minutes > 0))
    check('total = text + proposed artifacts, recall excluded', Math.abs(les.total_minutes - sum(nonRecall, b => b.minutes)) < 0.15 && les.recall_minutes > 0, [les.total_minutes, les.text_minutes, les.artifact_minutes])
    check('proposed artifacts use the default estimates (2.7 + 2.9 + 2.7)', Math.abs(les.artifact_minutes - 8.3) < 0.01, les.artifact_minutes)
    check('over_budget matches total vs budget', les.over_budget === (les.total_minutes > les.time_budget_minutes))
    check('second text generation refused', (await api('POST', `${L}/${id1}/text/generate`)).errorType === 'validation')
    check('blueprint is locked once text exists', (await api('PUT', `${L}/${id1}/blueprint`, { objective: 'x' })).errorType === 'validation')
    check('blueprint regeneration refused once text exists', (await api('POST', `${L}/${id1}/blueprint/generate`)).errorType === 'validation')

    console.log('Over-budget flag')
    const idSmall = await newApprovedLesson({ timeBudgetMinutes: 5 })
    r = await api('POST', `${L}/${idSmall}/text/generate`)
    check('5-minute lesson with 3 proposed artifacts is flagged over budget', r.data.lesson.over_budget === true && r.data.lesson.total_minutes > 5, [r.data.lesson.total_minutes])
    check('text budget in the prompt scales (40% of 5 = 2 minutes)', /at most 2 minutes/.test(prompts.filter(p => /^Plan a lesson blueprint/.test(p)).pop().replace(/\s+/g, ' ')))

    console.log('Accept a placement: generate new (saved in the PRIMARY source)')
    const kcBlock = les.blocks[4]
    r = await api('POST', `${L}/${id1}/blocks/${kcBlock.id}/artifact`, { mode: 'new' })
    check('new knowledge check generated', r.ok === true, r)
    const kcAfter = r.data.lesson.blocks[4]
    check('block is ready with a { source, artifact } reference', kcAfter.state === 'ready' && kcAfter.ref.source === PRIMARY && /^knowledge-check-\d+$/.test(kcAfter.ref.artifact), kcAfter)
    check('artifact file is saved under the primary source', fs.existsSync(path.join(artifactPath(PRIMARY, kcAfter.ref.artifact), 'artifact.json')))
    const key = `${kcAfter.ref.source}/${kcAfter.ref.artifact}`
    check('artifact is resolved inline in the response', r.data.artifacts[key] && r.data.artifacts[key].type === 'knowledge-check' && r.data.artifacts[key].items.length === 3)
    const kcPrompt = lastPrompt()
    check('in-lesson size: at most 3 items', /At most 3 items/.test(kcPrompt))
    check('objective locked to the lesson objective', /TARGET LEARNING OBJECTIVE \(locked[^)]*\)[\s\S]*?Edited objective/.test(kcPrompt))
    check('prompt carries the placement context', /inserted into a lesson on "Check changeover"/.test(kcPrompt) && /after the section "EDITED-TITLE-2"|after the section "How does order change it\?"/.test(kcPrompt) && /NOTE-KC/.test(kcPrompt))
    check('prompt draws on BOTH lesson sources', /SECOND-SOURCE-TEXT/.test(kcPrompt))
    check('lesson steering carried into the artifact', /PERGEN-X/.test(kcPrompt) && /STYLE-X/.test(kcPrompt))
    check('total recomputed after accepting', Math.abs(r.data.lesson.total_minutes - sum(r.data.lesson.blocks.filter(b => b.kind !== 'recall'), b => b.minutes)) < 0.15)
    check('block minutes now come from the real artifact', typeof r.data.lesson.blocks[4].minutes === 'number')
    // REWRITTEN for C2: a slot that already holds an artifact can be replaced.
    const oldKcFolder = kcAfter.ref.artifact
    await sleep(5)
    r = await api('POST', `${L}/${id1}/blocks/${kcBlock.id}/artifact`, { mode: 'new' })
    const replacedBlock = r.data?.lesson?.blocks.find(b => b.id === kcBlock.id)
    check('a slot that already has an artifact can be REPLACED by a new one', r.ok === true && replacedBlock.state === 'ready' && replacedBlock.ref.artifact !== oldKcFolder && /^knowledge-check-\d+$/.test(replacedBlock.ref.artifact), r)
    check('the replaced artifact\'s files are untouched', fs.existsSync(path.join(artifactPath(PRIMARY, oldKcFolder), 'artifact.json')))
    check('the replaced artifact is still in the project list (and so in the picker)', (await api('GET', `/projects/${P}/artifacts?type=knowledge-check`)).data.some(a => a.folder === oldKcFolder && a.source === PRIMARY))
    check('the new artifact is saved in the primary source folder too', replacedBlock.ref.source === PRIMARY && fs.existsSync(path.join(artifactPath(PRIMARY, replacedBlock.ref.artifact), 'artifact.json')))
    check('the lesson still has the same number of blocks', r.data.lesson.blocks.length === les.blocks.length)

    r = await api('POST', `${L}/${id1}/blocks/${les.blocks[2].id}/artifact`, { mode: 'new' })
    check('in-lesson flip deck: at most 4 cards', r.ok && /At most 4 cards/.test(lastPrompt()), r)
    r = await api('POST', `${L}/${id1}/blocks/${les.blocks[6].id}/artifact`, { mode: 'new' })
    check('in-lesson scenario: exactly 2 decisions', r.ok && /- exactly 2 decision points/.test(lastPrompt()), r)
    check('all three proposals are now ready', r.data.lesson.blocks.filter(b => b.kind === 'artifact').every(b => b.state === 'ready'))
    check('every generated artifact lives in the primary source folder', r.data.lesson.blocks.filter(b => b.kind === 'artifact').every(b => b.ref.source === PRIMARY))
    check('project list now includes the lesson artifacts', (await api('GET', `/projects/${P}/artifacts`)).data.some(a => a.folder === kcAfter.ref.artifact))

    console.log('Accept a placement: pick existing')
    const smallBlocks = (await api('GET', `${L}/${idSmall}`)).data.lesson.blocks
    const smallKc = smallBlocks.find(b => b.artifact_type === 'knowledge-check' && b.state === 'proposed')
    const smallFlip = smallBlocks.find(b => b.artifact_type === 'flip-card-deck')
    const secondKc = (await api('GET', `/projects/${P}/artifacts?type=knowledge-check`)).data.find(a => a.source === SECOND)
    const secondDeck = (await api('GET', `/projects/${P}/artifacts?type=flip-card-deck`)).data[0]
    check('mode required', (await api('POST', `${L}/${idSmall}/blocks/${smallFlip.id}/artifact`, {})).errorType === 'validation')
    const noKeyBlock = smallFlip
    check('type mismatch rejected (knowledge check into a flip slot)', (await api('POST', `${L}/${idSmall}/blocks/${noKeyBlock.id}/artifact`, { mode: 'existing', source: secondKc.source, artifact: secondKc.folder })).errorType === 'validation')
    check('nonexistent artifact → not_found', (await api('POST', `${L}/${idSmall}/blocks/${smallKc.id}/artifact`, { mode: 'existing', source: PRIMARY, artifact: 'knowledge-check-42' })).errorType === 'not_found')
    check('path traversal → not_found', (await api('POST', `${L}/${idSmall}/blocks/${smallKc.id}/artifact`, { mode: 'existing', source: '..', artifact: 'x' })).errorType === 'not_found' && (await api('POST', `${L}/${idSmall}/blocks/${smallKc.id}/artifact`, { mode: 'existing', source: PRIMARY, artifact: '../../project' })).errorType === 'not_found')
    fs.writeFileSync(path.join(HOME, 'Byte', 'settings.json'), JSON.stringify({ provider: 'anthropic' }))
    r = await api('POST', `${L}/${idSmall}/blocks/${smallKc.id}/artifact`, { mode: 'existing', source: secondKc.source, artifact: secondKc.folder })
    check('picking an existing artifact needs no AI provider key', r.ok === true, r)
    const picked = r.data.lesson.blocks.find(b => b.id === smallKc.id)
    check('reference points at the SECOND source, not a copy', picked.state === 'ready' && picked.ref.source === SECOND && picked.ref.artifact === secondKc.folder)
    check('picking the artifact the slot already uses is rejected', (await api('POST', `${L}/${idSmall}/blocks/${smallKc.id}/artifact`, { mode: 'existing', source: secondKc.source, artifact: secondKc.folder })).errorType === 'validation')
    const flips = (await api('GET', `/projects/${P}/artifacts?type=flip-card-deck`)).data.filter(a => !a.folder.startsWith('flip-cards-'))
    await api('POST', `${L}/${idSmall}/blocks/${smallFlip.id}/artifact`, { mode: 'existing', source: flips[0].source, artifact: flips[0].folder })
    r = await api('POST', `${L}/${idSmall}/blocks/${smallFlip.id}/artifact`, { mode: 'existing', source: flips[1].source, artifact: flips[1].folder })
    check('a ready block can be replaced with another existing artifact', r.ok && r.data.lesson.blocks.find(b => b.id === smallFlip.id).ref.artifact === flips[1].folder, r)
    check('the artifact it replaced is untouched and still listed', fs.existsSync(path.join(artifactPath(flips[0].source, flips[0].folder), 'artifact.json')) && (await api('GET', `/projects/${P}/artifacts?type=flip-card-deck`)).data.some(a => a.folder === flips[0].folder))
    check('no copy was made (primary source gained nothing)', !fs.readdirSync(path.join(HOME, 'Byte', 'projects', P, 'sources', PRIMARY, 'artifacts')).some(f => f === secondKc.folder))
    check('generating new with no key → missing_api_key', (await api('POST', `${L}/${idSmall}/blocks/${smallBlocks.find(b => b.artifact_type === 'scenario-branching').id}/artifact`, { mode: 'new' })).errorType === 'missing_api_key')
    check('blueprint generation with no key → missing_api_key', (await api('POST', `${L}/${(await api('POST', L, { topic: 'Z', sources: [PRIMARY] })).data.lesson.id}/blueprint/generate`)).errorType === 'missing_api_key')
    await api('POST', '/settings', { provider: 'local', model: 'm', baseUrl: `${MOCK}/v1` })

    console.log('References, not copies')
    const sharedDir = artifactPath(SECOND, secondKc.folder)
    const onDisk = JSON.parse(fs.readFileSync(path.join(sharedDir, 'artifact.json'), 'utf-8'))
    onDisk.items[0].stem = 'EDITED-ON-DISK stem'
    fs.writeFileSync(path.join(sharedDir, 'artifact.json'), JSON.stringify(onDisk))
    r = await api('GET', `${L}/${idSmall}`)
    check('editing the artifact shows up in the lesson that references it', r.data.artifacts[`${SECOND}/${secondKc.folder}`].items[0].stem === 'EDITED-ON-DISK stem')

    console.log('Orphaned references: never auto-deleted')
    const blockCount = r.data.lesson.blocks.length
    fs.rmSync(sharedDir, { recursive: true, force: true })
    r = await api('GET', `${L}/${idSmall}`)
    const orphan = r.data.lesson.blocks.find(b => b.id === smallKc.id)
    check('missing artifact: block is kept and marked unavailable', r.ok && orphan && orphan.unavailable === true && r.data.lesson.blocks.length === blockCount, orphan)
    check('missing artifact resolves to null', r.data.artifacts[`${SECOND}/${secondKc.folder}`] === null)
    check('orphan time falls back to the default estimate', orphan.minutes === 2.9)
    check('the lesson file itself still holds the block', JSON.parse(fs.readFileSync(path.join(HOME, 'Byte', 'projects', P, 'lessons', idSmall, 'lesson.json'), 'utf-8')).blocks.some(b => b.id === smallKc.id && b.ref))
    const replacement = (await api('GET', `/projects/${P}/artifacts?type=knowledge-check`)).data[0]
    r = await api('POST', `${L}/${idSmall}/blocks/${smallKc.id}/artifact`, { mode: 'existing', source: replacement.source, artifact: replacement.folder })
    check('an orphaned slot can be re-pointed ("pick another")', r.ok && r.data.lesson.blocks.find(b => b.id === smallKc.id).ref.artifact === replacement.folder, r)
    await api('DELETE', `/projects/${P}/sources/${SECOND}`)
    const afterSourceDelete = await api('GET', L)
    check('deleting a whole source does not break or delete lessons', afterSourceDelete.ok && afterSourceDelete.data.some(l => l.id === id1))
    r = await api('GET', `${L}/${id1}`)
    check('lesson still loads after its secondary source is gone', r.ok && r.data.lesson.blocks.length === 10)

    console.log('Remove an artifact block (REWRITTEN for C2: proposed, ready, and orphaned)')
    const idD = await newApprovedLesson()
    r = await api('POST', `${L}/${idD}/text/generate`)
    const dBlocks = r.data.lesson.blocks
    const n0 = dBlocks.length
    const totalBefore = r.data.lesson.total_minutes
    r = await api('DELETE', `${L}/${idD}/blocks/${dBlocks.find(b => b.artifact_type === 'flip-card-deck').id}`)
    check('a proposed artifact can be removed (same as dismissing)', r.ok && r.data.lesson.blocks.length === n0 - 1 && !r.data.lesson.blocks.some(b => b.artifact_type === 'flip-card-deck'), r)
    check('removal recomputes the total (flip deck default 2.7 min removed)', Math.abs((totalBefore - r.data.lesson.total_minutes) - 2.7) < 0.05, [totalBefore, r.data.lesson.total_minutes])
    check('the last hook still cannot be removed (text blocks are removable since D1)', (await api('DELETE', `${L}/${idD}/blocks/${dBlocks[0].id}`)).errorType === 'validation')
    check('unknown block → not_found', (await api('DELETE', `${L}/${idD}/blocks/b999`)).errorType === 'not_found')

    const scenBlockId = dBlocks.find(b => b.artifact_type === 'scenario-branching').id
    r = await api('POST', `${L}/${idD}/blocks/${scenBlockId}/artifact`, { mode: 'new' })
    const scenRef = r.data.lesson.blocks.find(b => b.id === scenBlockId).ref
    const scenMinutes = r.data.lesson.blocks.find(b => b.id === scenBlockId).minutes
    const totalWithScen = r.data.lesson.total_minutes
    r = await api('DELETE', `${L}/${idD}/blocks/${scenBlockId}`)
    check('a READY artifact block can be removed', r.ok && !r.data.lesson.blocks.some(b => b.id === scenBlockId), r)
    check('its files are left in place', fs.existsSync(path.join(artifactPath(scenRef.source, scenRef.artifact), 'artifact.json')))
    check('it is still in the project list, so still in the picker', (await api('GET', `/projects/${P}/artifacts?type=scenario-branching`)).data.some(a => a.folder === scenRef.artifact))
    check('the time meter total drops by that block\'s minutes', Math.abs((totalWithScen - r.data.lesson.total_minutes) - scenMinutes) < 0.05, [totalWithScen, r.data.lesson.total_minutes, scenMinutes])
    check('removal is saved to the lesson file', !JSON.parse(fs.readFileSync(path.join(HOME, 'Byte', 'projects', P, 'lessons', idD, 'lesson.json'), 'utf-8')).blocks.some(b => b.id === scenBlockId))

    const kcDId = dBlocks.find(b => b.artifact_type === 'knowledge-check').id
    const anyKc = (await api('GET', `/projects/${P}/artifacts?type=knowledge-check`)).data[0]
    await api('POST', `${L}/${idD}/blocks/${kcDId}/artifact`, { mode: 'existing', source: anyKc.source, artifact: anyKc.folder })
    const orphanDir = artifactPath(anyKc.source, anyKc.folder)
    const hold = fs.mkdtempSync(path.join(os.tmpdir(), 'hold-'))
    fs.cpSync(orphanDir, path.join(hold, 'a'), { recursive: true })   // keep a copy so later tests still find it
    fs.rmSync(orphanDir, { recursive: true, force: true })
    check('an orphaned block shows as unavailable first', (await api('GET', `${L}/${idD}`)).data.lesson.blocks.find(b => b.id === kcDId).unavailable === true)
    r = await api('DELETE', `${L}/${idD}/blocks/${kcDId}`)
    check('an orphaned block can be removed too', r.ok && !r.data.lesson.blocks.some(b => b.id === kcDId), r)
    fs.cpSync(path.join(hold, 'a'), orphanDir, { recursive: true })   // restore for the rest of the run
    fs.rmSync(hold, { recursive: true, force: true })

    console.log('Block context (C2 commit 2)')
    const idX = await newApprovedLesson()
    const xBlocks = (await api('POST', `${L}/${idX}/text/generate`)).data.lesson.blocks
    const xFlip = xBlocks.find(b => b.artifact_type === 'flip-card-deck')
    const xKc = xBlocks.find(b => b.artifact_type === 'knowledge-check')
    const xScen = xBlocks.find(b => b.artifact_type === 'scenario-branching')
    const norm = t => t.replace(/\s+/g, ' ')
    const gen = (id, ctx) => api('POST', `${L}/${idX}/blocks/${id}/artifact`, ctx === undefined ? { mode: 'new' } : { mode: 'new', context: ctx })
    const blockOf = r => r.data.lesson.blocks.find(b => b.artifact_type === 'flip-card-deck')

    r = await gen(xFlip.id)
    check('limits are returned: 4 cards, 3 questions, scenarios 2 to 3', r.data.limits['flip-card-deck'].max === 4 && r.data.limits['knowledge-check'].max === 3 && r.data.limits['scenario-branching'].max === 3 && r.data.limits['scenario-branching'].default === 2, r.data.limits)
    check('no context: the prompt still carries a BLOCK CONTEXT with the placement', /═══ BLOCK CONTEXT \(this block only\) ═══\nPlacement: This artifact will be inserted into a lesson on/.test(lastPrompt()))
    check('no context: no Focus / Source section / Notes lines', !/^Focus:/m.test(lastPrompt()) && !/^Source section:/m.test(lastPrompt()) && !/^Notes:/m.test(lastPrompt()))
    check('no context: nothing stored on the block, default 4 cards', blockOf(r).generation_context === undefined && /At most 4 cards/.test(lastPrompt()))
    check('standalone prompts are unchanged (no BLOCK CONTEXT section)', (await (async () => { await api('POST', `/projects/${P}/sources/${PRIMARY}/artifacts/generate`, { artifactType: 'flip-card-deck' }); return !/BLOCK CONTEXT/.test(lastPrompt()) })()))

    console.log('Priority layers: system prompt text')
    const sysN = norm(lastSystem())
    check('system prompt defines the BLOCK CONTEXT layer', /BLOCK CONTEXT A generation inside a lesson also carries a BLOCK CONTEXT section/.test(sysN))
    check('scope-based rules: item rules and principles always win; style guide = voice, tone, names; custom instructions = content emphasis', /these scope-based rules apply to every generation: - The item writing rules and the design principles in this prompt always win\. - The accessibility rules in this prompt always win too\. No style guide, custom instruction, per-generation prompt, or block context can switch them off\. - The style guide controls voice, tone, and names\. - The custom instructions control content emphasis\./.test(sysN), sysN.slice(sysN.indexOf('Apply all three'), sysN.indexOf('Apply all three') + 700))
    check('the old single-line ranking sentence is gone', !/Per-Generation Prompt > Custom Instructions > Style Guide/.test(sysN))
    check('block context overrides custom instructions for that block\'s content focus only', /it overrides the custom instructions for that block's content focus only/.test(sysN))
    check('block context never overrides voice, tone, names, or item rules', /It never overrides voice, tone, names, or the item writing rules/.test(sysN))
    check('the per-generation prompt does not override voice, tone, names, or item rules', /per-generation prompt is a one-off adjustment for this artifact\. For content emphasis it overrides the custom instructions\. It does not override voice, tone, names, or the item writing rules/.test(sysN))
    check('source section is soft guidance with a fallback note', /Source section" means draw mainly from the part of the sources that matches it/.test(sysN) && /say so in spaced_repetition_notes/.test(sysN))

    console.log('Priority layer: custom instruction + block focus')
    await api('PUT', `/projects/${P}`, { customInstructions: 'emphasize risks' })
    const FOCUS = 'host, client, and server roles'
    await sleep(5)
    r = await gen(xFlip.id, { focus: FOCUS })
    const deck1 = r.data.artifacts[`${blockOf(r).ref.source}/${blockOf(r).ref.artifact}`]
    const pr = lastPrompt()
    check('the project custom instruction is in the prompt', /═══ PROJECT CUSTOM INSTRUCTIONS ═══\nemphasize risks/.test(pr))
    check('the block focus is in the prompt', new RegExp(`═══ BLOCK CONTEXT \\(this block only\\) ═══\\nPlacement: [^\\n]+\\nFocus: ${FOCUS}`).test(pr))
    check('the block context comes AFTER the custom instructions and the style guide', pr.indexOf('BLOCK CONTEXT (this block only)') > pr.indexOf('PROJECT CUSTOM INSTRUCTIONS') && pr.indexOf('PROJECT CUSTOM INSTRUCTIONS') > pr.indexOf('PROJECT STYLE GUIDE'))
    check('the system prompt sent with it carries the scope-based rules', /The style guide controls voice, tone, and names/.test(norm(lastSystem())) && /The custom instructions control content emphasis/.test(norm(lastSystem())))
    check('the deck reflects the focus (mock echoes it: proves the focus reaches the model)', deck1.cards.every(c => c.front.includes(FOCUS)), deck1.cards.map(c => c.front))

    console.log('generation_context: stored, sanitized, regenerated')
    await sleep(5)
    const longText = 'n'.repeat(1500)
    r = await gen(xFlip.id, { focus: `  ${FOCUS}  `, source_section: '  Roles section ', count: 3, experience: 'expert', notes: 'use the mix-ups section for distractors', bogus: 'x' })
    let fb = blockOf(r)
    check('the context is stored on the block, trimmed, with unknown fields dropped', JSON.stringify(fb.generation_context) === JSON.stringify({ focus: FOCUS, source_section: 'Roles section', notes: 'use the mix-ups section for distractors', experience: 'Expert', count: 3 }), fb.generation_context)
    const pc = lastPrompt()
    check('focus, source section, and notes appear as lines in the BLOCK CONTEXT', new RegExp(`^Focus: ${FOCUS}$`, 'm').test(pc) && /^Source section: Roles section$/m.test(pc) && /^Notes: use the mix-ups section for distractors$/m.test(pc))
    check('count 3 limits the deck to "At most 3 cards"', /At most 3 cards/.test(pc))
    check('experience override applies to this generation only', /Experience level: Expert/.test(pc) && (await api('GET', `${L}/${idX}`)).data.lesson.context.experience === 'Practicing')
    const prevFolder = fb.ref.artifact
    await sleep(5)
    r = await gen(xFlip.id)   // no context key: Regenerate reuses what the block stored
    fb = blockOf(r)
    check('Regenerate with no context reuses the stored one', /^Focus: host, client, and server roles$/m.test(lastPrompt()) && /Experience level: Expert/.test(lastPrompt()) && /At most 3 cards/.test(lastPrompt()) && fb.generation_context.focus === FOCUS)
    check('Regenerate makes a DIFFERENT artifact; the previous one stays on disk', fb.ref.artifact !== prevFolder && fs.existsSync(path.join(artifactPath(PRIMARY, prevFolder), 'artifact.json')))
    check('both the new and the old artifacts are listed in the project', (await api('GET', `/projects/${P}/artifacts?type=flip-card-deck`)).data.filter(a => a.folder === prevFolder || a.folder === fb.ref.artifact).length === 2)
    await sleep(5)
    r = await gen(xFlip.id, { focus: 'a different focus' })
    fb = blockOf(r)
    check('an edited context replaces the stored one', fb.generation_context.focus === 'a different focus' && fb.generation_context.notes === undefined && /^Focus: a different focus$/m.test(lastPrompt()))
    await sleep(5)
    r = await gen(xFlip.id, {})
    check('an explicit empty context clears it', blockOf(r).generation_context === undefined && !/^Focus:/m.test(lastPrompt()))
    await sleep(5)
    r = await gen(xFlip.id, { focus: longText, notes: longText, source_section: longText })
    const clipped = blockOf(r).generation_context
    check('long text is capped (focus 300, source section 200, notes 1000)', clipped.focus.length === 300 && clipped.source_section.length === 200 && clipped.notes.length === 1000, [clipped.focus.length, clipped.source_section.length, clipped.notes.length])
    r = await gen(xFlip.id, 'not an object')
    check('a non-object context is ignored', r.ok === true && blockOf(r).generation_context === undefined)

    console.log('Count limits')
    await sleep(5)
    r = await gen(xFlip.id, { count: 9 })
    check('flip: count 9 is clamped to 4', /At most 4 cards/.test(lastPrompt()) && blockOf(r).generation_context.count === 4)
    await sleep(5)
    r = await gen(xFlip.id, { count: 1 })
    check('flip: count 1 is clamped up to 3', /At most 3 cards/.test(lastPrompt()))
    await sleep(5)
    r = await gen(xKc.id, { count: 1 })
    check('knowledge check: count 1 is clamped up to 2', /At most 2 items/.test(lastPrompt()))
    await sleep(5)
    r = await gen(xKc.id, { count: 3 })
    check('knowledge check: count 3 is allowed', /At most 3 items/.test(lastPrompt()))
    await sleep(5)
    r = await gen(xKc.id, {})
    check('knowledge check: default is 3', /At most 3 items/.test(lastPrompt()))
    await sleep(5)
    r = await gen(xScen.id, { count: 3 })
    check('scenario: count 3 gives exactly 3 decisions', /- exactly 3 decision points/.test(lastPrompt()))
    await sleep(5)
    r = await gen(xScen.id, { count: 1 })
    check('scenario: count 1 is clamped up to 2', /- exactly 2 decision points/.test(lastPrompt()))
    await sleep(5)
    r = await gen(xScen.id, { count: 'x' })
    check('scenario: a non-numeric count is ignored (default 2)', /- exactly 2 decision points/.test(lastPrompt()) && r.data.lesson.blocks.find(b => b.artifact_type === 'scenario-branching').generation_context === undefined)
    await sleep(5)
    r = await gen(xScen.id, { count: 2.5 })
    check('scenario: a fractional count is ignored', /- exactly 2 decision points/.test(lastPrompt()))

    console.log('Context on other kinds of block')
    await sleep(5)
    r = await gen(xKc.id, { focus: 'KC-FOCUS', experience: 'weird' })
    check('an unknown experience level is dropped', r.data.lesson.blocks.find(b => b.artifact_type === 'knowledge-check').generation_context.experience === undefined && /Experience level: Practicing/.test(lastPrompt()))
    check('a knowledge check carries the focus too', /^Focus: KC-FOCUS$/m.test(lastPrompt()))

    console.log('A failed regenerate changes nothing')
    const before = blockOf((await api('GET', `${L}/${idX}`)))
    mode = 'notjson'
    r = await gen(xFlip.id, { focus: 'WILL-FAIL' })
    mode = 'ok'
    const after = blockOf((await api('GET', `${L}/${idX}`)))
    check('the error is reported', r.ok === false && r.errorType === 'malformed_json', r)
    check('the block keeps its artifact AND its previous context', after.ref.artifact === before.ref.artifact && JSON.stringify(after.generation_context) === JSON.stringify(before.generation_context))

    console.log('Tabs proposals from the text step')
    const wordsOf = (...p) => p.filter(x => typeof x === 'string').join(' ').trim().split(/\s+/).filter(Boolean).length
    const idT = await newApprovedLesson()
    mode = 'text_with_tabs'
    r = await api('POST', `${L}/${idT}/text/generate`)
    mode = 'ok'
    let tl = r.data.lesson
    const tabsProp = tl.blocks.find(b => b.kind === 'tabs')
    check('the text step can propose a tabs block (4 placements allowed)', r.ok && tabsProp && tabsProp.state === 'proposed' && /NOTE-TABS/.test(tabsProp.placement_note), r)
    check('a proposed tabs block has no tabs yet and is not edited', Array.isArray(tabsProp.tabs) && tabsProp.tabs.length === 0 && tabsProp.edited === false)
    check('block order: tabs follow the section they were proposed for', tl.blocks.map(b => b.kind + (b.artifact_type ? `:${b.artifact_type}` : '')).slice(0, 5).join() === 'hook,chunk,artifact:flip-card-deck,tabs,chunk')
    check('a proposed tabs block uses the default estimate (1.4 min)', tabsProp.minutes === 1.4)
    check('tabs time counts as text, not as an artifact', Math.abs(tl.artifact_minutes - 8.3) < 0.01 && Math.abs(tl.text_minutes - sum(tl.blocks.filter(b => b.kind !== 'artifact' && b.kind !== 'recall'), b => b.minutes)) < 0.15, [tl.artifact_minutes, tl.text_minutes])
    const tp = prompts.filter(p => /^Write the text of a lesson/.test(p)).pop().replace(/\s+/g, ' ')
    check('the text prompt explains tabs proposals and the 4-placement cap', /Propose 1 to 4 placements/.test(tp) && /"tabs" is not an artifact/.test(tp) && /parallel ideas/.test(tp) && /A tabs block takes about 1\.4/.test(tp))
    const idT5 = await newApprovedLesson()
    mode = 'text_five_placements'
    check('5 placements are refused (cap is 4)', (await api('POST', `${L}/${idT5}/text/generate`)).errorType === 'schema_validation')
    const idT6 = await newApprovedLesson()
    mode = 'text_tabs_only'
    check('a tabs proposal alone does not satisfy the retrieval rule', (await api('POST', `${L}/${idT6}/text/generate`)).errorType === 'schema_validation')
    mode = 'ok'

    console.log('Generate tabs (accept a proposal / regenerate)')
    const TFOCUS = 'compare host, client, and server'
    r = await api('POST', `${L}/${idT}/blocks/${tabsProp.id}/tabs/generate`, { context: { focus: TFOCUS, count: 3, source_section: 'Roles section', notes: 'keep it parallel' } })
    let tb = r.data.lesson.blocks.find(b => b.id === tabsProp.id)
    check('a proposed tabs block can be generated', r.ok && tb.state === 'ready' && tb.tabs.length === 3 && tb.edited === false, r)
    const tprompt = lastPrompt()
    check('the tabs prompt is built from the lesson sources and carries the BLOCK CONTEXT', /^Write a tabs block/.test(tprompt) && /SECOND-SOURCE-TEXT|Active listening|active listening/i.test(tprompt) && /═══ BLOCK CONTEXT \(this block only\) ═══\nPlacement: This tabs block will be inserted into a lesson on/.test(tprompt) && new RegExp(`^Focus: ${TFOCUS}$`, 'm').test(tprompt) && /^Source section: Roles section$/m.test(tprompt) && /^Notes: keep it parallel$/m.test(tprompt))
    check('the same steering layers apply (style guide, custom instructions)', /STYLE-X/.test(tprompt) && /emphasize risks/.test(tprompt))
    check('count 3 asks for exactly 3 tabs; labels and bodies are length-limited in the prompt', /Exactly 3 tabs/.test(tprompt) && /at most 24 characters/.test(tprompt) && /at most 50 words/.test(tprompt))
    check('tabs rules: parallel labels, same internal order, stand-alone, no names, no markdown', /Keep labels parallel/.test(tprompt) && /same \s*internal order|same internal order/.test(tprompt.replace(/\s+/g, ' ')) && /Every tab stands alone/.test(tprompt) && /Do not name people/.test(tprompt.replace(/\s+/g, ' ')) && /plain text/.test(tprompt))
    check('the focus reached the model (mock echoes it into the title)', tb.title === `Tabs :: ${TFOCUS}`, tb.title)
    check('generation_context is stored on the tabs block', tb.generation_context.focus === TFOCUS && tb.generation_context.count === 3 && tb.generation_context.source_section === 'Roles section')
    check('the visual note is kept on the tab that has one', tb.tabs[0].visual === 'TAB-VISUAL a diagram' && tb.tabs[1].visual === undefined)
    check('tabs get stable ids t1..t3', tb.tabs.map(t => t.id).join() === 't1,t2,t3')
    const expectedMin = Math.round(((wordsOf(tb.title) + tb.tabs.reduce((a, t) => a + wordsOf(t.label, t.body), 0)) / 200 + 0.25 * tb.tabs.length) * 10) / 10
    check('time = words / 200 plus 15 s per tab', tb.minutes === expectedMin && expectedMin === 1.4, [tb.minutes, expectedMin])
    check('the meter total counts the tab text', Math.abs(r.data.lesson.total_minutes - sum(r.data.lesson.blocks.filter(b => b.kind !== 'recall'), b => b.minutes)) < 0.15)
    r = await api('POST', `${L}/${idT}/blocks/${tabsProp.id}/tabs/generate`, {})
    check('regenerate with no context reuses the stored one', r.ok && /^Focus: compare host, client, and server$/m.test(lastPrompt()) && /Exactly 3 tabs/.test(lastPrompt()))
    r = await api('POST', `${L}/${idT}/blocks/${tabsProp.id}/tabs/generate`, { context: {} })
    check('without a count Byte decides: "2 to 5 tabs"', /2 to 5 tabs, as many as the content needs/.test(lastPrompt()) && !/^Focus:/m.test(lastPrompt()) && r.data.lesson.blocks.find(b => b.id === tabsProp.id).generation_context === undefined)
    r = await api('POST', `${L}/${idT}/blocks/${tabsProp.id}/tabs/generate`, { context: { count: 9 } })
    check('tab count is clamped to 5', /Exactly 5 tabs/.test(lastPrompt()) && r.data.lesson.blocks.find(b => b.id === tabsProp.id).tabs.length === 5)
    r = await api('POST', `${L}/${idT}/blocks/${tabsProp.id}/tabs/generate`, { context: { count: 1 } })
    check('and up to 2 at the low end', /Exactly 2 tabs/.test(lastPrompt()))
    check('generating tabs on an artifact block is refused', (await api('POST', `${L}/${idT}/blocks/${tl.blocks.find(b => b.kind === 'artifact').id}/tabs/generate`, {})).errorType === 'not_found')
    mode = 'notjson'
    const tabsBefore = JSON.stringify((await api('GET', `${L}/${idT}`)).data.lesson.blocks.find(b => b.id === tabsProp.id))
    r = await api('POST', `${L}/${idT}/blocks/${tabsProp.id}/tabs/generate`, { context: { focus: 'WILL-FAIL' } })
    mode = 'ok'
    check('a failed generation leaves the tabs block exactly as it was', r.errorType === 'malformed_json' && JSON.stringify((await api('GET', `${L}/${idT}`)).data.lesson.blocks.find(b => b.id === tabsProp.id)) === tabsBefore)

    console.log('Edit tabs inline')
    await api('POST', `${L}/${idT}/blocks/${tabsProp.id}/tabs/generate`, { context: { count: 3 } })
    const base0 = (await api('GET', `${L}/${idT}`)).data.lesson.blocks.find(b => b.id === tabsProp.id)
    const T = base0.tabs
    const put = (tabs, title) => api('PUT', `${L}/${idT}/blocks/${tabsProp.id}/tabs`, { title: title === undefined ? base0.title : title, tabs })
    r = await put(T)
    check('saving with no changes does not mark the block edited', r.ok && r.data.lesson.blocks.find(b => b.id === tabsProp.id).edited === false, r)
    r = await put(T.map((t, i) => i === 1 ? { ...t, label: 'Client edited', body: 'EDITED-BODY text typed by hand.' } : t))
    tb = r.data.lesson.blocks.find(b => b.id === tabsProp.id)
    check('editing a label and body saves them and sets edited', tb.tabs[1].label === 'Client edited' && tb.tabs[1].body.startsWith('EDITED-BODY') && tb.edited === true, tb)
    check('tab ids are preserved across an edit', tb.tabs.map(t => t.id).join() === 't1,t2,t3')
    check('the edit changes the time (shorter body)', tb.minutes < base0.minutes, [base0.minutes, tb.minutes])
    r = await put([tb.tabs[2], tb.tabs[0], tb.tabs[1]])
    check('tabs can be reordered; the order is saved', r.data.lesson.blocks.find(b => b.id === tabsProp.id).tabs.map(t => t.id).join() === 't3,t1,t2')
    r = await put([...tb.tabs, { label: 'Fourth', body: 'FOURTH body.' }, { label: 'Fifth', body: 'FIFTH body.' }])
    tb = r.data.lesson.blocks.find(b => b.id === tabsProp.id)
    check('tabs can be added, up to 5; new tabs get fresh ids', tb.tabs.length === 5 && new Set(tb.tabs.map(t => t.id)).size === 5 && tb.tabs.map(t => t.id).includes('t4') && tb.tabs.map(t => t.id).includes('t5'), tb.tabs.map(t => t.id))
    check('a 6th tab is refused', (await put([...tb.tabs, { label: 'Sixth', body: 'x' }])).errorType === 'validation')
    r = await put(tb.tabs.slice(0, 2))
    check('tabs can be removed, down to 2', r.ok && r.data.lesson.blocks.find(b => b.id === tabsProp.id).tabs.length === 2, r)
    check('a single tab is refused', (await put(tb.tabs.slice(0, 1))).errorType === 'validation')
    check('an empty label is refused', (await put([{ label: '  ', body: 'x' }, tb.tabs[0]])).errorType === 'validation')
    check('an empty body is refused', (await put([{ label: 'A', body: '' }, tb.tabs[0]])).errorType === 'validation')
    check('a label over 40 characters is refused', (await put([{ label: 'L'.repeat(41), body: 'x' }, tb.tabs[0]])).errorType === 'validation')
    check('a body over 1,500 characters is refused', (await put([{ label: 'A', body: 'b'.repeat(1501) }, tb.tabs[0]])).errorType === 'validation')
    check('a 6,000-character visual note saves without error (old 300 limit gone)', (await put([{ label: 'A', body: 'x', visual: 'v'.repeat(6000) }, tb.tabs[0]])).ok === true)
    check('only an absurd visual note (over 10,000) is refused', (await put([{ label: 'A', body: 'x', visual: 'v'.repeat(10001) }, tb.tabs[0]])).errorType === 'validation')
    check('a non-array is refused', (await put('nope')).errorType === 'validation')
    check('a rejected edit changes nothing', (await api('GET', `${L}/${idT}`)).data.lesson.blocks.find(b => b.id === tabsProp.id).tabs.length === 2)
    check('editing a title works and is capped at 120 characters', (await put((await api('GET', `${L}/${idT}`)).data.lesson.blocks.find(b => b.id === tabsProp.id).tabs, 'T'.repeat(300))).data.lesson.blocks.find(b => b.id === tabsProp.id).title.length === 120)

    console.log('Regenerate over hand edits needs confirmation')
    r = await api('POST', `${L}/${idT}/blocks/${tabsProp.id}/tabs/generate`, { context: { count: 3 } })
    check('regenerating an edited block without overwrite is refused', r.errorType === 'validation' && /your edits/.test(r.userMessage), r)
    check('the hand edits are still there', (await api('GET', `${L}/${idT}`)).data.lesson.blocks.find(b => b.id === tabsProp.id).tabs.length === 2)
    r = await api('POST', `${L}/${idT}/blocks/${tabsProp.id}/tabs/generate`, { context: { count: 3 }, overwrite: true })
    tb = r.data.lesson.blocks.find(b => b.id === tabsProp.id)
    check('with overwrite:true it replaces them and clears the edited flag', r.ok && tb.edited === false && tb.tabs.length === 3, r)

    console.log('Write a proposed tabs block by hand')
    const idT2 = await newApprovedLesson()
    mode = 'text_with_tabs'
    const t2 = (await api('POST', `${L}/${idT2}/text/generate`)).data.lesson
    mode = 'ok'
    const prop2 = t2.blocks.find(b => b.kind === 'tabs')
    const promptsBeforeWrite = prompts.length
    r = await api('PUT', `${L}/${idT2}/blocks/${prop2.id}/tabs`, { title: 'Mine', tabs: [{ label: 'Host', body: 'My host text.' }, { label: 'Client', body: 'My client text.' }] })
    tb = r.data.lesson.blocks.find(b => b.id === prop2.id)
    check('a proposal written by hand becomes ready and edited', r.ok && tb.state === 'ready' && tb.edited === true && tb.tabs.length === 2 && tb.title === 'Mine', r)
    check('no model call was made to write it by hand', prompts.length === promptsBeforeWrite)

    console.log('Remove tabs blocks')
    r = await api('DELETE', `${L}/${idT2}/blocks/${prop2.id}`)
    check('a tabs block can be removed', r.ok && !r.data.lesson.blocks.some(b => b.id === prop2.id), r)
    const idT3 = await newApprovedLesson()
    mode = 'text_with_tabs'
    const t3 = (await api('POST', `${L}/${idT3}/text/generate`)).data.lesson
    mode = 'ok'
    r = await api('DELETE', `${L}/${idT3}/blocks/${t3.blocks.find(b => b.kind === 'tabs').id}`)
    check('a proposed tabs block can be removed too', r.ok && !r.data.lesson.blocks.some(b => b.kind === 'tabs'))
    check('the last hook still cannot be removed', (await api('DELETE', `${L}/${idT3}/blocks/${t3.blocks[0].id}`)).errorType === 'validation')

    console.log('Insert here: tabs and artifacts')
    const idI = await newApprovedLesson()
    const iBase = (await api('POST', `${L}/${idI}/text/generate`)).data.lesson
    const hook = iBase.blocks[0], chunk1 = iBase.blocks[1]
    const nBlocks = iBase.blocks.length
    const ins = body => api('POST', `${L}/${idI}/blocks`, body)

    r = await ins({ after: hook.id, kind: 'tabs', mode: 'write', title: 'Written', tabs: [{ label: 'One', body: 'First idea.' }, { label: 'Two', body: 'Second idea.' }] })
    const wrote = r.data.lesson.blocks[1]
    check('tabs written by hand are inserted right after the chosen block', r.ok && wrote.kind === 'tabs' && wrote.title === 'Written' && r.data.lesson.blocks[0].id === hook.id && r.data.lesson.blocks.length === nBlocks + 1, r)
    check('a hand-written block is marked edited and ready', wrote.edited === true && wrote.state === 'ready')
    check('the new block gets the next free id', wrote.id === `b${nBlocks + 1}`, wrote.id)
    check('inserting adds the tab text to the time', r.data.lesson.total_minutes > iBase.total_minutes)

    r = await ins({ after: chunk1.id, kind: 'tabs', mode: 'generate', context: { focus: TFOCUS, count: 3 } })
    const gen3 = r.data.lesson.blocks.find(b => b.kind === 'tabs' && b.id !== wrote.id)
    check('tabs can be generated at the insert point', r.ok && gen3.tabs.length === 3 && gen3.edited === false && gen3.title === `Tabs :: ${TFOCUS}` && gen3.generation_context.focus === TFOCUS, r)
    check('it sits right after the block chosen', r.data.lesson.blocks[r.data.lesson.blocks.findIndex(b => b.id === chunk1.id) + 1].id === gen3.id)

    const kcList = (await api('GET', `/projects/${P}/artifacts?type=knowledge-check`)).data
    const applyBlock = iBase.blocks.find(b => b.kind === 'apply')
    const foldersBefore = JSON.stringify(fs.readdirSync(path.join(HOME, 'Byte', 'projects', P, 'sources', PRIMARY, 'artifacts')).sort())
    r = await ins({ after: applyBlock.id, kind: 'artifact', artifact_type: 'knowledge-check', mode: 'existing', source: kcList[0].source, artifact: kcList[0].folder })
    const insKc = r.data.lesson.blocks.find(b => b.kind === 'artifact' && b.ref && b.ref.artifact === kcList[0].folder && b.id !== undefined && !iBase.blocks.some(x => x.id === b.id))
    check('an existing artifact can be inserted', r.ok && insKc && insKc.state === 'ready' && insKc.generation_context === undefined, r)
    check('inserting an existing artifact copies nothing (no new artifact folders)', JSON.stringify(fs.readdirSync(path.join(HOME, 'Byte', 'projects', P, 'sources', PRIMARY, 'artifacts')).sort()) === foldersBefore)

    await sleep(5)
    r = await ins({ after: applyBlock.id, kind: 'artifact', artifact_type: 'flip-card-deck', mode: 'new', context: { focus: 'INSERT-FOCUS', count: 3 } })
    const insFlip = r.data.lesson.blocks.find(b => b.artifact_type === 'flip-card-deck' && b.generation_context && b.generation_context.focus === 'INSERT-FOCUS')
    check('a new artifact can be generated at the insert point', r.ok && insFlip && insFlip.state === 'ready' && insFlip.ref.source === PRIMARY && /^flip-card-deck-\d+$/.test(insFlip.ref.artifact), r)
    check('the inserted artifact\'s prompt has the placement, the focus, and the count', /Placement: This artifact will be inserted into a lesson on/.test(lastPrompt()) && /^Focus: INSERT-FOCUS$/m.test(lastPrompt()) && /At most 3 cards/.test(lastPrompt()))
    check('the new artifact is saved in the primary source folder', fs.existsSync(path.join(artifactPath(PRIMARY, insFlip.ref.artifact), 'artifact.json')))
    check('block ids stay unique after several inserts', new Set(r.data.lesson.blocks.map(b => b.id)).size === r.data.lesson.blocks.length)

    // closes the gap: a REMOVED artifact can be added back
    const removedRef = insKc.ref
    r = await api('DELETE', `${L}/${idI}/blocks/${insKc.id}`)
    check('(setup) the knowledge check block is removed', r.ok && !r.data.lesson.blocks.some(b => b.id === insKc.id))
    check('removed artifact: its files are still there', fs.existsSync(path.join(artifactPath(removedRef.source, removedRef.artifact), 'artifact.json')))
    r = await ins({ after: applyBlock.id, kind: 'artifact', artifact_type: 'knowledge-check', mode: 'existing', source: removedRef.source, artifact: removedRef.artifact })
    check('a removed artifact can be re-added to the lesson with Insert here', r.ok && r.data.lesson.blocks.some(b => b.kind === 'artifact' && b.ref && b.ref.artifact === removedRef.artifact), r)
    check('ids are never reused after a removal', new Set(r.data.lesson.blocks.map(b => b.id)).size === r.data.lesson.blocks.length)

    console.log('Insert: rules and failures')
    const lastRecall = [...iBase.blocks].reverse().find(b => b.kind === 'recall')
    check('nothing can be inserted after a recall prompt', (await ins({ after: lastRecall.id, kind: 'tabs', mode: 'write', tabs: [{ label: 'A', body: 'a' }, { label: 'B', body: 'b' }] })).errorType === 'validation')
    check('an unknown "after" block is not_found', (await ins({ after: 'b999', kind: 'tabs', mode: 'write', tabs: [] })).errorType === 'not_found')
    check('a missing "after" is not_found', (await ins({ kind: 'tabs', mode: 'write', tabs: [] })).errorType === 'not_found')
    check('an unknown kind is refused', (await ins({ after: hook.id, kind: 'chunk', mode: 'write' })).errorType === 'validation')
    check('tabs need a mode', (await ins({ after: hook.id, kind: 'tabs' })).errorType === 'validation')
    check('an unsupported artifact type is refused', (await ins({ after: hook.id, kind: 'artifact', artifact_type: 'podcast', mode: 'new' })).errorType === 'validation')
    check('an artifact insert needs a mode', (await ins({ after: hook.id, kind: 'artifact', artifact_type: 'flip-card-deck' })).errorType === 'validation')
    check('invalid tabs are refused (one tab)', (await ins({ after: hook.id, kind: 'tabs', mode: 'write', tabs: [{ label: 'A', body: 'a' }] })).errorType === 'validation')
    check('wrong artifact type for the slot is refused', (await ins({ after: hook.id, kind: 'artifact', artifact_type: 'flip-card-deck', mode: 'existing', source: kcList[0].source, artifact: kcList[0].folder })).errorType === 'validation')
    check('a nonexistent artifact is not_found; path tricks too', (await ins({ after: hook.id, kind: 'artifact', artifact_type: 'knowledge-check', mode: 'existing', source: PRIMARY, artifact: 'knowledge-check-42' })).errorType === 'not_found' && (await ins({ after: hook.id, kind: 'artifact', artifact_type: 'knowledge-check', mode: 'existing', source: '..', artifact: 'x' })).errorType === 'not_found')
    const countBefore = (await api('GET', `${L}/${idI}`)).data.lesson.blocks.length
    mode = 'notjson'
    r = await ins({ after: hook.id, kind: 'tabs', mode: 'generate', context: { focus: 'FAILS' } })
    check('a failed generated insert reports the error', r.errorType === 'malformed_json', r)
    r = await ins({ after: hook.id, kind: 'artifact', artifact_type: 'flip-card-deck', mode: 'new' })
    mode = 'ok'
    check('...and adds nothing to the lesson (all or nothing)', (await api('GET', `${L}/${idI}`)).data.lesson.blocks.length === countBefore)
    const approvedOnly = await newApprovedLesson()
    check('inserting before the text is written is refused', (await api('POST', `${L}/${approvedOnly}/blocks`, { after: 'b1', kind: 'tabs', mode: 'write', tabs: [] })).errorType === 'validation')
    fs.writeFileSync(path.join(HOME, 'Byte', 'settings.json'), JSON.stringify({ provider: 'anthropic' }))
    check('writing tabs by hand needs no AI key', (await ins({ after: hook.id, kind: 'tabs', mode: 'write', tabs: [{ label: 'K', body: 'no key needed' }, { label: 'L', body: 'still none' }] })).ok === true)
    check('inserting an existing artifact needs no AI key', (await ins({ after: hook.id, kind: 'artifact', artifact_type: 'knowledge-check', mode: 'existing', source: kcList[1].source, artifact: kcList[1].folder })).ok === true)
    check('generating tabs with no key → missing_api_key', (await ins({ after: hook.id, kind: 'tabs', mode: 'generate' })).errorType === 'missing_api_key')
    check('generating an artifact at the insert point with no key → missing_api_key', (await ins({ after: hook.id, kind: 'artifact', artifact_type: 'flip-card-deck', mode: 'new' })).errorType === 'missing_api_key')
    await api('POST', '/settings', { provider: 'local', model: 'm', baseUrl: `${MOCK}/v1` })

    console.log('Fix 2: picking an existing artifact clears the block\'s context')
    const idF = await newApprovedLesson()
    const fBlocks = (await api('POST', `${L}/${idF}/text/generate`)).data.lesson.blocks
    const fFlipId = fBlocks.find(b => b.artifact_type === 'flip-card-deck').id
    await api('POST', `${L}/${idF}/blocks/${fFlipId}/artifact`, { mode: 'new', context: { focus: 'OLD-FOCUS', notes: 'OLD-NOTES', count: 3 } })
    check('(setup) the block holds a generation_context', (await api('GET', `${L}/${idF}`)).data.lesson.blocks.find(b => b.id === fFlipId).generation_context.focus === 'OLD-FOCUS')
    const currentFlipFolder = (await api('GET', `${L}/${idF}`)).data.lesson.blocks.find(b => b.id === fFlipId).ref.artifact
    const otherFlip = (await api('GET', `/projects/${P}/artifacts?type=flip-card-deck`)).data.find(a => a.folder !== currentFlipFolder && !a.folder.startsWith('flip-cards-'))
    r = await api('POST', `${L}/${idF}/blocks/${fFlipId}/artifact`, { mode: 'existing', source: otherFlip.source, artifact: otherFlip.folder })
    check('picking an existing artifact CLEARS generation_context', r.ok && r.data.lesson.blocks.find(b => b.id === fFlipId).generation_context === undefined, r.data?.lesson?.blocks.find(b => b.id === fFlipId))
    check('...and the lesson file no longer holds it', JSON.parse(fs.readFileSync(path.join(HOME, 'Byte', 'projects', P, 'lessons', idF, 'lesson.json'), 'utf-8')).blocks.find(b => b.id === fFlipId).generation_context === undefined)
    await sleep(5)
    await api('POST', `${L}/${idF}/blocks/${fFlipId}/artifact`, { mode: 'new' })
    check('Regenerate on that block starts empty: none of the old context is in the prompt', !/OLD-FOCUS|OLD-NOTES/.test(lastPrompt()) && !/^Focus:/m.test(lastPrompt()) && /At most 4 cards/.test(lastPrompt()))

    console.log('Source cap is re-checked at generation time')
    const idC = await newApprovedLesson()
    await api('PUT', `/projects/${P}/sources/${PRIMARY}`, { content: '# Active\n\n' + 'y'.repeat(41000) })
    r = await api('POST', `${L}/${idC}/text/generate`)
    check('source grown past the cap → friendly error, nothing written', r.errorType === 'validation' && /Pick fewer sources/.test(r.userMessage) && (await api('GET', `${L}/${idC}`)).data.lesson.status === 'approved', r)

  } finally {
    await env.stopEnv(mock)
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
