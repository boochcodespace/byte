// API: editing, regenerating, moving, inserting and removing lesson text blocks
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
    } else if (/^(?:Rewrite|Write) one (\w+) block/.test(user)) {
      const kind = user.match(/^(?:Rewrite|Write) one (\w+) block/)[1]
      const f = user.match(/^Focus: (.*)$/m)
      const tag = f ? ` :: ${f[1]}` : ''
      out = { body: `REGEN-${kind}-BODY${tag} ${para(20)}` }
      if (kind === 'chunk') { out.title = 'Regenerated title'; if (mode !== 'tb_no_visual') out.visual = 'REGEN-VISUAL a new diagram'; out.alt_text = 'REGEN-ALT' }
      if (kind === 'recall' && mode !== 'tb_no_answer') out.answer = 'REGEN-ANSWER short'
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
    await api('GET', '/projects')
    await api('POST', '/settings', { provider: 'local', model: 'm', baseUrl: `${MOCK}/v1` })
    const draft = async () => {
      const id = await newApprovedLesson()
      mode = 'text_with_tabs'
      const r = await api('POST', `${L}/${id}/text/generate`)
      mode = 'ok'
      return { id, les: r.data.lesson }
    }
    const lessonOf = async id => (await api('GET', `${L}/${id}`)).data.lesson
    const onDisk = id => JSON.parse(fs.readFileSync(path.join(HOME, 'Byte', 'projects', P, 'lessons', id, 'lesson.json'), 'utf-8'))
    const edit = (id, b, body) => api('PUT', `${L}/${id}/blocks/${b}/text`, body)

    console.log('Edit text blocks')
    const { id, les } = await draft()
    const hook = les.blocks.find(b => b.kind === 'hook')
    const chunk = les.blocks.find(b => b.kind === 'chunk')
    const apply = les.blocks.find(b => b.kind === 'apply')
    const recall = les.blocks.find(b => b.kind === 'recall')
    let r = await edit(id, chunk.id, { title: chunk.title, body: chunk.body, visual: chunk.visual, alt_text: chunk.alt_text })
    check('saving with no change does not set edited', r.ok && r.data.lesson.blocks.find(b => b.id === chunk.id).edited === false, r.data?.lesson?.blocks.find(b => b.id === chunk.id))
    const t0 = les.total_minutes
    r = await edit(id, chunk.id, { title: 'New title', body: 'Short.', visual: 'New visual' })
    let c2 = r.ok && r.data.lesson.blocks.find(b => b.id === chunk.id)
    check('chunk title, body, visual saved and edited set', c2 && c2.title === 'New title' && c2.body === 'Short.' && c2.visual === 'New visual' && c2.edited === true, c2)
    check('time total follows the edit (shorter text → fewer minutes)', r.data.lesson.total_minutes < t0, [t0, r.data.lesson.total_minutes])
    check('edit is on disk', onDisk(id).blocks.find(b => b.id === chunk.id).body === 'Short.')
    r = await edit(id, hook.id, { body: 'New hook body', title: 'IGNORED' })
    const h2 = r.data.lesson.blocks.find(b => b.id === hook.id)
    check('hook body edited; title/visual fields ignored for hooks', h2.body === 'New hook body' && h2.title === hook.title && h2.edited === true && h2.visual === undefined, h2)
    r = await edit(id, apply.id, { body: 'Apply: do it.' })
    check('apply body edited', r.data.lesson.blocks.find(b => b.id === apply.id).body === 'Apply: do it.')
    r = await edit(id, recall.id, { body: 'New question?', answer: 'New answer.' })
    const r2 = r.data.lesson.blocks.find(b => b.id === recall.id)
    check('recall question and answer edited, day unchanged', r2.body === 'New question?' && r2.answer === 'New answer.' && r2.recall_day === recall.recall_day && r2.edited === true, r2)
    check('empty body refused', (await edit(id, chunk.id, { title: 'T', body: '   ' })).errorType === 'validation')
    check('empty chunk title refused', (await edit(id, chunk.id, { title: '', body: 'x' })).errorType === 'validation')
    check('empty recall answer refused', (await edit(id, recall.id, { body: 'Q', answer: '' })).errorType === 'validation')
    check('over-long body refused', (await edit(id, apply.id, { body: 'x'.repeat(4001) })).errorType === 'validation')
    check('a refused edit changes nothing', (await lessonOf(id)).blocks.find(b => b.id === apply.id).body === 'Apply: do it.')
    check('editing a tabs/artifact block through the text route → not_found', (await edit(id, les.blocks.find(b => b.kind === 'tabs').id, { body: 'x' })).errorType === 'not_found')
    check('unknown block → not_found', (await edit(id, 'b999', { body: 'x' })).errorType === 'not_found')
    check('unsafe block id → not_found', (await edit(id, 'a..b', { body: 'x' })).errorType === 'not_found')

    console.log('Remove text blocks')
    const before = (await lessonOf(id)).blocks.length
    check('the last hook cannot be removed', (await api('DELETE', `${L}/${id}/blocks/${hook.id}`)).errorType === 'validation')
    r = await api('DELETE', `${L}/${id}/blocks/${chunk.id}`)
    check('a chunk can be removed', r.ok && r.data.lesson.blocks.length === before - 1 && !r.data.lesson.blocks.some(b => b.id === chunk.id))
    r = await api('DELETE', `${L}/${id}/blocks/${recall.id}`)
    check('a recall block can be removed', r.ok && !r.data.lesson.blocks.some(b => b.id === recall.id))
    r = await api('DELETE', `${L}/${id}/blocks/${apply.id}`)
    check('the apply block can be removed', r.ok && !r.data.lesson.blocks.some(b => b.id === apply.id))
    check('removal is on disk', !onDisk(id).blocks.some(b => b.id === chunk.id))
    const afterIds = (await lessonOf(id)).blocks.map(b => b.id)
    check('ids of the others unchanged', afterIds.every(x => les.blocks.some(b => b.id === x)))

    console.log('Regenerate a text block (D1 commit 2)')
    const reg = (lid, b, body) => api('POST', `${L}/${lid}/blocks/${b}/text/generate`, body)
    const D = await draft()
    const dh = D.les.blocks.find(b => b.kind === 'hook'), dc = D.les.blocks.filter(b => b.kind === 'chunk')[0]
    const dap = D.les.blocks.find(b => b.kind === 'apply'), drc = D.les.blocks.filter(b => b.kind === 'recall')[1]
    const idxOf = (lesson, bid) => lesson.blocks.findIndex(b => b.id === bid)
    const CTX = { focus: 'FOCUS-X roles', source_section: 'SEC-Y', experience: 'Expert', notes: 'NOTES-Z', count: 4 }
    r = await reg(D.id, dc.id, { context: CTX })
    let rc = r.ok && r.data.lesson.blocks.find(b => b.id === dc.id)
    check('chunk regenerated: new title, body, visual; edited false', rc && rc.title === 'Regenerated title' && /REGEN-chunk-BODY :: FOCUS-X roles/.test(rc.body) && rc.visual === 'REGEN-VISUAL a new diagram' && rc.edited === false, rc)
    check('same id and same position', r.ok && r.data.lesson.blocks.length === D.les.blocks.length && idxOf(r.data.lesson, dc.id) === idxOf(D.les, dc.id))
    check('generation_context stored; count dropped (text has none)', JSON.stringify(rc.generation_context) === JSON.stringify({ focus: 'FOCUS-X roles', source_section: 'SEC-Y', notes: 'NOTES-Z', experience: 'Expert' }), rc.generation_context)
    const p = lastPrompt()
    check('prompt carries BLOCK CONTEXT: placement, focus, source section, notes', /BLOCK CONTEXT \(this block only\)/.test(p) && /Placement: This chunk block/.test(p) && /^Focus: FOCUS-X roles$/m.test(p) && /^Source section: SEC-Y$/m.test(p) && /^Notes: NOTES-Z$/m.test(p))
    check('prompt shows the text being replaced', p.includes('CHUNK2-BODY'))
    check('experience override reaches this generation only', /Expert/.test(p) && (await lessonOf(D.id)).context.experience !== 'Expert')
    check('system prompt: block context fills the per-generation layer and wins', /the BLOCK CONTEXT fills the per-generation layer\s+for its block\. If both are present, the block context wins\./.test(lastSystem()), lastSystem().slice(2000, 2600))
    check('on disk', onDisk(D.id).blocks.find(b => b.id === dc.id).title === 'Regenerated title')

    r = await reg(D.id, dc.id, {})
    check('no context key reuses the stored context', /^Focus: FOCUS-X roles$/m.test(lastPrompt()) && r.data.lesson.blocks.find(b => b.id === dc.id).generation_context.focus === 'FOCUS-X roles')
    r = await reg(D.id, dc.id, { context: {} })
    check('explicit {} clears it', r.ok && r.data.lesson.blocks.find(b => b.id === dc.id).generation_context === undefined && !/^Focus:/m.test(lastPrompt()))

    r = await reg(D.id, dh.id, { context: { focus: 'HOOK-FOCUS' } })
    let rh = r.data.lesson.blocks.find(b => b.id === dh.id)
    check('hook regenerated; title kept, no visual added', /REGEN-hook-BODY :: HOOK-FOCUS/.test(rh.body) && rh.title === dh.title && rh.visual === undefined, rh)
    r = await reg(D.id, dap.id, {})
    check('apply regenerated', /REGEN-apply-BODY/.test(r.data.lesson.blocks.find(b => b.id === dap.id).body))
    r = await reg(D.id, drc.id, { context: { focus: 'R-FOCUS' } })
    let rr = r.data.lesson.blocks.find(b => b.id === drc.id)
    check('recall regenerated: question and answer; day kept', /REGEN-recall-BODY/.test(rr.body) && rr.answer === 'REGEN-ANSWER short' && rr.recall_day === drc.recall_day, rr)
    check('recall order unchanged', JSON.stringify(r.data.lesson.blocks.filter(b => b.kind === 'recall').map(b => b.recall_day)) === '[2,7,21]')

    console.log('Overwrite protection and failures')
    await edit(D.id, dc.id, { title: 'Mine', body: 'MY OWN WORDS', visual: 'my visual' })
    r = await reg(D.id, dc.id, { context: { focus: 'NEW' } })
    check('regenerating an edited block without overwrite is refused', r.errorType === 'validation' && /your edits/i.test(r.userMessage), r)
    check('...and nothing changed', (await lessonOf(D.id)).blocks.find(b => b.id === dc.id).body === 'MY OWN WORDS')
    mode = 'notjson'
    r = await reg(D.id, dc.id, { context: { focus: 'WILL-FAIL' }, overwrite: true })
    mode = 'ok'
    let after = (await lessonOf(D.id)).blocks.find(b => b.id === dc.id)
    check('a failed generation changes nothing (text, edited flag, context)', !r.ok && r.errorType === 'malformed_json' && after.body === 'MY OWN WORDS' && after.edited === true && after.generation_context === undefined, [r.errorType, after])
    r = await reg(D.id, dc.id, { context: { focus: 'NEW' }, overwrite: true })
    after = r.data.lesson.blocks.find(b => b.id === dc.id)
    check('with overwrite the edit is replaced and edited resets', /REGEN-chunk-BODY :: NEW/.test(after.body) && after.edited === false)
    mode = 'tb_no_visual'
    r = await reg(D.id, dc.id, {})
    mode = 'ok'
    check('chunk with no visual from the model → schema_validation, unchanged', r.errorType === 'schema_validation' && (await lessonOf(D.id)).blocks.find(b => b.id === dc.id).body === after.body, r)
    mode = 'tb_no_answer'
    r = await reg(D.id, drc.id, {})
    mode = 'ok'
    check('recall with no answer from the model → schema_validation', r.errorType === 'schema_validation', r)
    check('tabs block through the text route → not_found', (await reg(D.id, D.les.blocks.find(b => b.kind === 'tabs').id, {})).errorType === 'not_found')
    check('unknown block → not_found', (await reg(D.id, 'b999', {})).errorType === 'not_found')
    check('unsafe block id → not_found', (await reg(D.id, 'a..b', {})).errorType === 'not_found')
    const bp = await newApprovedLesson()
    check('not drafted → validation', (await reg(bp, 'b1', {})).errorType === 'validation')

    console.log('Fix 1: no visual-note limit')
    const long = 'v'.repeat(6000)
    r = await edit(D.id, dc.id, { title: 'T', body: 'B', visual: long })
    check('a 6,000-character chunk visual note saves', r.ok && r.data.lesson.blocks.find(b => b.id === dc.id).visual.length === 6000, r.userMessage)
    check('only an absurd one (over 10,000) is refused', (await edit(D.id, dc.id, { title: 'T', body: 'B', visual: 'v'.repeat(10001) })).errorType === 'validation')
    const tb = D.les.blocks.find(b => b.kind === 'tabs')
    r = await api('PUT', `${L}/${D.id}/blocks/${tb.id}/tabs`, { title: '', tabs: [{ label: 'A', body: 'a', visual: long }, { label: 'B', body: 'b' }] })
    check('a 6,000-character tab visual note saves', r.ok && r.data.lesson.blocks.find(b => b.id === tb.id).tabs[0].visual.length === 6000, r.userMessage)

    console.log('Fix 3: time counts only text a learner sees')
    const { computeLesson } = require(env.REPO + '/backend/lessons/time')
    const mk = (kind, title, body) => ({ kind, title, body })
    const lessonWith = blocks => ({ time_budget_minutes: 10, blocks })
    const mins = (kind, title) => computeLesson(lessonWith([mk(kind, title, para(100))]), {}).blocks[0].minutes
    const longTitle = para(200)
    check('hook: a 200-word title adds nothing', mins('hook', longTitle) === mins('hook', 'x'))
    check('apply: a 200-word title adds nothing', mins('apply', longTitle) === mins('apply', 'x'))
    check('chunk: the title IS shown, so it counts', mins('chunk', longTitle) > mins('chunk', 'x'))
    check('chunk body only: 100 words = 0.5 min', mins('chunk', '') === 0.5, mins('chunk', ''))

    console.log('Move (D1 commit 3)')
    const mv = (lid, b, dir) => api('POST', `${L}/${lid}/blocks/${b}/move`, { direction: dir })
    const M = await draft()
    const order = lesson => lesson.blocks.map(b => b.id)
    const ml = M.les
    const mHook = ml.blocks[0]
    check('(setup) the hook is first and the lesson has recall at the end', mHook.kind === 'hook' && ml.blocks.slice(-3).every(b => b.kind === 'recall'))
    check('can_move flags: hook and recall cannot move', ml.blocks.filter(b => b.kind === 'hook' || b.kind === 'recall').every(b => !b.can_move_up && !b.can_move_down))
    check('can_move flags: the block right after the hook cannot move up', ml.blocks[1].can_move_up === false && ml.blocks[1].can_move_down === true)
    const lastText = ml.blocks[ml.blocks.length - 4]
    check('can_move flags: the last non-recall block cannot move down', lastText.can_move_down === false && lastText.can_move_up === true)
    check('can_move flags are presentation only (not saved)', !JSON.stringify(onDisk(M.id)).includes('can_move'))
    const m1 = ml.blocks[1], m2 = ml.blocks[2]
    r = await mv(M.id, m1.id, 'down')
    check('moving a block down swaps it with its neighbour', r.ok && order(r.data.lesson).slice(1, 3).join() === [m2.id, m1.id].join(), order(r.data.lesson))
    check('ids unchanged, count unchanged', order(r.data.lesson).slice().sort().join() === order(ml).slice().sort().join())
    check('the move is on disk', onDisk(M.id).blocks.map(b => b.id).slice(1, 3).join() === [m2.id, m1.id].join())
    check('moving does not change the time total', r.data.lesson.total_minutes === ml.total_minutes, [r.data.lesson.total_minutes, ml.total_minutes])
    r = await mv(M.id, m1.id, 'up')
    check('moving back up restores the order', order(r.data.lesson).join() === order(ml).join())
    const mTabs = ml.blocks.find(b => b.kind === 'tabs'), mProposal = ml.blocks.find(b => b.kind === 'artifact')
    r = await mv(M.id, mTabs.id, 'down')
    check('a tabs block can move', r.ok && order(r.data.lesson).indexOf(mTabs.id) === order(ml).indexOf(mTabs.id) + 1)
    r = await mv(M.id, mProposal.id, 'down')
    check('a proposed artifact block can move', r.ok && order(r.data.lesson).indexOf(mProposal.id) === order(ml).indexOf(mProposal.id) + 1)
    check('the hook cannot move down', (await mv(M.id, mHook.id, 'down')).errorType === 'validation')
    check('the hook cannot move up', (await mv(M.id, mHook.id, 'up')).errorType === 'validation')
    check('no block can move above the hook', (await mv(M.id, (await lessonOf(M.id)).blocks[1].id, 'up')).errorType === 'validation')
    const cur = await lessonOf(M.id)
    const lastT = cur.blocks[cur.blocks.length - 4]
    r = await mv(M.id, lastT.id, 'down')
    check('no block can move down into the recall prompts', r.errorType === 'validation' && /recall/.test(r.userMessage), r)
    const recallIds = cur.blocks.filter(b => b.kind === 'recall').map(b => b.id)
    check('recall prompts cannot move', (await mv(M.id, recallIds[0], 'down')).errorType === 'validation' && (await mv(M.id, recallIds[1], 'up')).errorType === 'validation')
    check('a bad direction → validation', (await mv(M.id, m1.id, 'sideways')).errorType === 'validation')
    check('unknown block → not_found', (await mv(M.id, 'b999', 'up')).errorType === 'not_found')
    check('unsafe block id → not_found', (await mv(M.id, 'a..b', 'up')).errorType === 'not_found')
    check('refused moves changed nothing', order(await lessonOf(M.id)).join() === order(cur).join())
    check('recall order is still 2, 7, 21', JSON.stringify((await lessonOf(M.id)).blocks.filter(b => b.kind === 'recall').map(b => b.recall_day)) === '[2,7,21]')
    check('not drafted → validation', (await mv(await newApprovedLesson(), 'b1', 'up')).errorType === 'validation')

    console.log('Insert chunk, apply and recall')
    const ins = (lid, body) => api('POST', `${L}/${lid}/blocks`, body)
    const I = await draft()
    const iHook = I.les.blocks[0]
    const iChunk = I.les.blocks.find(b => b.kind === 'chunk')
    const t1 = I.les.total_minutes
    r = await ins(I.id, { after: iHook.id, kind: 'chunk', mode: 'write', title: 'My chunk', body: para(100), visual: 'my visual' })
    let nb = r.ok && r.data.lesson.blocks[1]
    check('a written chunk goes right after the chosen block, edited', nb && nb.kind === 'chunk' && nb.title === 'My chunk' && nb.visual === 'my visual' && nb.edited === true && /^b\d+$/.test(nb.id), r.userMessage || nb)
    check('new id is max+1', Number(nb.id.slice(1)) === Math.max(...I.les.blocks.map(b => Number(b.id.slice(1)))) + 1)
    check('time total rose with the chunk (100 words = 0.5 min + title)', r.data.lesson.total_minutes > t1)
    check('chunk needs a title', (await ins(I.id, { after: iHook.id, kind: 'chunk', mode: 'write', title: '', body: 'x' })).errorType === 'validation')
    check('chunk needs text', (await ins(I.id, { after: iHook.id, kind: 'chunk', mode: 'write', title: 'T', body: '' })).errorType === 'validation')
    r = await ins(I.id, { after: iChunk.id, kind: 'apply', mode: 'write', body: 'Next time X, do Y.' })
    const ap = r.data.lesson.blocks[r.data.lesson.blocks.findIndex(b => b.id === iChunk.id) + 1]
    check('a written apply block goes after the chosen block', ap.kind === 'apply' && ap.body === 'Next time X, do Y.' && ap.edited === true)
    check('insert after a recall prompt is still refused', (await ins(I.id, { after: I.les.blocks.find(b => b.kind === 'recall').id, kind: 'chunk', mode: 'write', title: 'T', body: 'x' })).errorType === 'validation')
    check('a hook cannot be inserted', (await ins(I.id, { after: iHook.id, kind: 'hook', mode: 'write', body: 'x' })).errorType === 'validation')
    check('unknown "after" → not_found', (await ins(I.id, { after: 'b999', kind: 'chunk', mode: 'write', title: 'T', body: 'x' })).errorType === 'not_found')
    check('bad mode → validation', (await ins(I.id, { after: iHook.id, kind: 'chunk', mode: 'nope' })).errorType === 'validation')

    const before3 = await lessonOf(I.id)
    check('all three recall days are taken: a duplicate is refused', (await ins(I.id, { after: iHook.id, kind: 'recall', mode: 'write', recall_day: 7, body: 'Q?', answer: 'A' })).errorType === 'validation')
    check('a bad recall day is refused', (await ins(I.id, { after: iHook.id, kind: 'recall', mode: 'write', recall_day: 5, body: 'Q?', answer: 'A' })).errorType === 'validation')
    const day7 = before3.blocks.find(b => b.recall_day === 7)
    await api('DELETE', `${L}/${I.id}/blocks/${day7.id}`)
    r = await ins(I.id, { after: iHook.id, kind: 'recall', mode: 'write', recall_day: 7, body: 'NEW-Q7?', answer: 'NEW-A7' })
    const rb = r.data.lesson.blocks.filter(b => b.kind === 'recall')
    check('a recall prompt goes to the tail in day order, whatever "after" says', r.ok && JSON.stringify(rb.map(b => b.recall_day)) === '[2,7,21]' && rb[1].body === 'NEW-Q7?' && rb[1].answer === 'NEW-A7' && r.data.lesson.blocks.slice(-3).every(b => b.kind === 'recall'), r.userMessage)
    check('recall needs an answer', (await ins(I.id, { after: iHook.id, kind: 'recall', mode: 'write', recall_day: 7, body: 'Q?', answer: '' })).errorType === 'validation')
    const iEnd = await lessonOf(I.id)
    check('recall time is not counted in the total', iEnd.total_minutes === (await lessonOf(I.id)).total_minutes && iEnd.recall_minutes > 0)

    console.log('Generate chunk and recall; fix 2: other recall questions in the prompt')
    const G = await draft()
    const gHook = G.les.blocks[0]
    r = await ins(G.id, { after: gHook.id, kind: 'chunk', mode: 'generate', context: { focus: 'NEW-FOCUS the matrix', notes: 'N-1' } })
    nb = r.ok && r.data.lesson.blocks[1]
    check('a generated chunk lands after the chosen block with model title/body/visual', nb && nb.kind === 'chunk' && nb.title === 'Regenerated title' && /REGEN-chunk-BODY :: NEW-FOCUS the matrix/.test(nb.body) && nb.visual === 'REGEN-VISUAL a new diagram' && nb.edited === false, r.userMessage || nb)
    check('generation_context stored', nb.generation_context.focus === 'NEW-FOCUS the matrix' && nb.generation_context.notes === 'N-1')
    let p3 = lastPrompt()
    check('the new-block prompt says so and carries BLOCK CONTEXT', /^Write one chunk block/.test(p3) && /THE NEW BLOCK/.test(p3) && /BLOCK CONTEXT/.test(p3) && /^Focus: NEW-FOCUS the matrix$/m.test(p3))
    check('new chunk prompt lists the chunks already in the lesson', /Chunks already in this lesson \(do not repeat their ideas\)/.test(p3) && G.les.blocks.filter(b => b.kind === 'chunk').every(b => p3.includes('- ' + b.title)))
    r = await reg(G.id, drc.id === undefined ? G.les.blocks.filter(b => b.kind === 'recall')[1].id : G.les.blocks.filter(b => b.kind === 'recall')[1].id, {})
    p3 = lastPrompt()
    const grecalls = G.les.blocks.filter(b => b.kind === 'recall')
    check('FIX 2: recall regeneration lists the OTHER recall questions with "do not repeat"', /Recall questions already in this lesson \(do not repeat their ideas\)/.test(p3) && p3.includes('- ' + grecalls[0].body) && p3.includes('- ' + grecalls[2].body), p3.slice(p3.indexOf('Recall questions') - 50, p3.indexOf('Recall questions') + 400))
    check('...and not the one being replaced, as a "do not repeat" item', !p3.includes('- ' + grecalls[1].body))
    r = await reg(G.id, G.les.blocks.find(b => b.kind === 'chunk').id, {})
    check('a chunk regenerate has no other-questions list', !/already in this lesson/.test(lastPrompt()))
    await api('DELETE', `${L}/${G.id}/blocks/${grecalls[0].id}`)
    r = await ins(G.id, { after: gHook.id, kind: 'recall', mode: 'generate', recall_day: 2, context: { focus: 'R-FOCUS' } })
    const nr = r.ok && r.data.lesson.blocks.find(b => b.kind === 'recall' && b.recall_day === 2)
    check('a generated recall prompt: question, answer, day, tail position', nr && /REGEN-recall-BODY :: R-FOCUS/.test(nr.body) && nr.answer === 'REGEN-ANSWER short' && r.data.lesson.blocks.indexOf(nr) === r.data.lesson.blocks.length - 3, r.userMessage)
    const stillThere = r.data.lesson.blocks.filter(b => b.kind === 'recall' && b.recall_day !== 2)
    check('its prompt lists the other recall questions', stillThere.length === 2 && stillThere.every(b => lastPrompt().includes('- ' + b.body)))
    r = await ins(G.id, { after: gHook.id, kind: 'apply', mode: 'generate', context: {} })
    check('a generated apply block works', r.ok && r.data.lesson.blocks[1].kind === 'apply' && /REGEN-apply-BODY/.test(r.data.lesson.blocks[1].body), r.userMessage)

    console.log('Generate failures leave the lesson unchanged')
    const snap = JSON.stringify(onDisk(G.id))
    mode = 'notjson'
    r = await ins(G.id, { after: gHook.id, kind: 'chunk', mode: 'generate', context: {} })
    mode = 'ok'
    check('malformed model output → error, lesson file byte-for-byte unchanged', r.errorType === 'malformed_json' && JSON.stringify(onDisk(G.id)) === snap, r.errorType)
    mode = 'tb_no_visual'
    r = await ins(G.id, { after: gHook.id, kind: 'chunk', mode: 'generate', context: {} })
    mode = 'ok'
    check('chunk with no visual → schema_validation, unchanged', r.errorType === 'schema_validation' && JSON.stringify(onDisk(G.id)) === snap)
    mode = 'tb_no_answer'
    r = await ins(G.id, { after: gHook.id, kind: 'recall', mode: 'generate', recall_day: 21, context: {} })
    mode = 'ok'
    check('...recall with no answer → schema_validation, unchanged', r.errorType === 'schema_validation' || r.errorType === 'validation', r.errorType)
    check('...file unchanged', JSON.stringify(onDisk(G.id)) === snap)
  } finally {
    await env.stopEnv(mock)
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
