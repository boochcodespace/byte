// backend/lessons/service.js
//
// The lesson workflow. A lesson is a text-first document:
//
//   create  →  blueprint  →  (edit, approve)  →  text  →  placements
//
//   1. create: topic + sources. Learner context is PREFILLED from the
//      primary (first) source and can be edited in the blueprint step.
//   2. blueprint: the model plans an objective and sections with a time
//      budget. The user edits and approves it.
//   3. text: one text block per approved section, plus PROPOSED artifact
//      placements. Nothing is generated for a proposal until accepted.
//   4. accept a placement: generate a new artifact for this lesson (saved
//      in the primary source's folder) or pick an existing one from the
//      project. The block stores a reference, never a copy.
//
// Blocks are never deleted automatically. If a referenced artifact or
// source disappears, the block stays and is marked unavailable.

const { buildPromptContext, normalizeExperience } =
  require('../artifact-types/shared/build-prompt-context')
const { generateValidated, SchemaValidationError } =
  require('../artifact-types/shared/generate')
const { getTypeModule } = require('../artifact-types/registry')
const store = require('./store')
const { loadSources, assertWithinCap } = require('./sources')
const { computeLesson } = require('./time')
const { blueprintPrompt, textPrompt, tabsPrompt } = require('./prompts')
const { validation, notFound } = require('./errors')
const blueprintSchema = require('./schemas/blueprint.schema.json')
const textSchema = require('./schemas/text.schema.json')
const tabsSchema = require('./schemas/tabs.schema.json')

const DEFAULT_BUDGET = 10
const MIN_BUDGET = 5
const MAX_BUDGET = 10

const BLUEPRINT_MAX_TOKENS = 3000
const TEXT_MAX_TOKENS = 6500
const TABS_MAX_TOKENS = 2500

// In-lesson artifact sizes. Standalone defaults are larger; these keep a
// lesson with a few artifacts inside its time budget. The user may pick a
// count inside [min, max] in the context panel; anything else is clamped.
const IN_LESSON_SIZES = {
  'flip-card-deck': { default: 4, min: 3, max: 4 },
  'knowledge-check': { default: 3, min: 2, max: 3 },
  'scenario-branching': { default: 2, min: 2, max: 3 },
  // Tabs are a block, not an artifact. With no count, Byte decides (2 to 5).
  tabs: { default: null, min: 2, max: 5 },
}

// Turn a count into the extras the type's prompt template understands.
// A scenario gets exactly that many decisions, so its time is predictable.
function extrasFor(type, count) {
  const size = IN_LESSON_SIZES[type]
  if (!size || type === 'tabs') return {}
  const n = count === undefined || count === null ? size.default : count
  if (type === 'flip-card-deck') return { maxCards: n }
  if (type === 'knowledge-check') return { maxItems: n }
  return { minDecisions: n, maxDecisions: n }
}

// The per-block steering a user can set. Every field is optional. Only
// non-empty fields are kept; text is trimmed and capped; the count is
// clamped to the in-lesson limits; unknown fields are ignored.
const MAX_FOCUS = 300
const MAX_SOURCE_SECTION = 200
const MAX_NOTES = 1000

function sanitizeGenerationContext(type, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out = {}
  const focus = str(raw.focus).slice(0, MAX_FOCUS)
  if (focus) out.focus = focus
  const section = str(raw.source_section).slice(0, MAX_SOURCE_SECTION)
  if (section) out.source_section = section
  const notes = str(raw.notes).slice(0, MAX_NOTES)
  if (notes) out.notes = notes
  const experience = experienceOrEmpty(raw.experience)
  if (experience) out.experience = experience
  const size = IN_LESSON_SIZES[type]
  if (size && raw.count !== undefined && raw.count !== null && raw.count !== '') {
    const n = Number(raw.count)
    if (Number.isInteger(n)) out.count = Math.min(size.max, Math.max(size.min, n))
  }
  return out
}

// ── small helpers ────────────────────────────────────────────────────

const str = v => (typeof v === 'string' ? v.trim() : '')
const round1 = n => Math.round(n * 10) / 10

function clampBudget(v) {
  const n = Number(v)
  if (v === undefined || v === null || v === '' || !Number.isFinite(n)) return DEFAULT_BUDGET
  return Math.min(MAX_BUDGET, Math.max(MIN_BUDGET, Math.round(n * 2) / 2))
}

function clampMinutes(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) throw validation('Section minutes must be a number.')
  return Math.min(10, Math.max(0, round1(n)))
}

function experienceOrEmpty(v) {
  const n = normalizeExperience(v)
  return n === 'not specified' ? '' : n
}

function requireProject(projectSlug) {
  const project = store.readProject(projectSlug)
  if (!project) throw notFound('Project not found.')
  return project
}

function requireLesson(projectSlug, lessonId) {
  const lesson = store.readLesson(projectSlug, lessonId)
  if (!lesson) throw notFound('Lesson not found.')
  return lesson
}

// ── presenting a lesson ──────────────────────────────────────────────

function resolveArtifacts(projectSlug, lesson) {
  const map = {}
  for (const block of lesson.blocks || []) {
    if (block.kind === 'artifact' && block.ref) {
      const key = store.artifactKey(block.ref.source, block.ref.artifact)
      if (!(key in map)) map[key] = store.readArtifact(projectSlug, block.ref.source, block.ref.artifact)
    }
  }
  return map
}

// The shape the API returns: the lesson with computed minutes and totals,
// plus every referenced artifact resolved inline (null when it is gone).
function presentLesson(projectSlug, lesson) {
  const artifacts = resolveArtifacts(projectSlug, lesson)
  const computed = computeLesson(lesson, artifacts)
  computed.blocks = computed.blocks.map(b => {
    if (b.kind !== 'artifact' || !b.ref) return b
    const key = store.artifactKey(b.ref.source, b.ref.artifact)
    return artifacts[key] ? b : { ...b, unavailable: true }
  })
  return { lesson: computed, artifacts, limits: IN_LESSON_SIZES }
}

function summarizeLesson(projectSlug, lesson) {
  const computed = computeLesson(lesson, resolveArtifacts(projectSlug, lesson))
  return {
    id: lesson.id,
    title: lesson.title,
    topic: lesson.topic,
    status: lesson.status,
    objective: lesson.objective,
    time_budget_minutes: lesson.time_budget_minutes,
    total_minutes: computed.total_minutes,
    over_budget: computed.over_budget,
    updated_at: lesson.updated_at,
  }
}

function listLessons(projectSlug) {
  requireProject(projectSlug)
  return store.listLessons(projectSlug).map(l => summarizeLesson(projectSlug, l))
}

function getLesson(projectSlug, lessonId) {
  requireProject(projectSlug)
  return presentLesson(projectSlug, requireLesson(projectSlug, lessonId))
}

// ── create ───────────────────────────────────────────────────────────

function createLesson(projectSlug, input) {
  requireProject(projectSlug)

  const topic = str(input.topic)
  if (!topic) throw validation('Enter a topic for the lesson.')

  const slugs = Array.isArray(input.sources) ? input.sources : []
  if (slugs.length === 0) throw validation('Pick at least one source for the lesson.')
  if (new Set(slugs).size !== slugs.length) throw validation('Each source can only be picked once.')

  const { sources, totalChars } = loadSources(projectSlug, slugs)
  assertWithinCap(totalChars)

  // Learner context is prefilled from the primary source; the user can
  // edit it in the blueprint step.
  const c = sources[0].context || {}
  const context = {
    role: str(c.role),
    experience: experienceOrEmpty(c.experience),
    useCase: str(c.useCase),
    learningObjectives: str(c.learningObjectives),
  }

  const title = (str(input.title) || topic).slice(0, 120)
  const now = new Date().toISOString()
  const lesson = {
    type: 'lesson',
    id: store.newLessonId(projectSlug, title),
    title,
    topic,
    status: 'blueprint',
    time_budget_minutes: clampBudget(input.timeBudgetMinutes),
    context,
    steering: {
      per_generation_prompt: str(input.perGenerationPrompt),
      per_generation_objective: str(input.perGenerationObjective),
    },
    sources: slugs,
    objective: '',
    blueprint: null,
    blocks: [],
    created_at: now,
    updated_at: now,
  }
  store.writeLesson(projectSlug, lesson)
  return presentLesson(projectSlug, lesson)
}

// Shared by every model call: the prompt context for this lesson.
function buildLessonContext(project, lesson, sourceText) {
  return buildPromptContext({
    sourceContent: sourceText,
    context: lesson.context,
    project,
    perGenerationPrompt: lesson.steering?.per_generation_prompt,
    perGenerationObjective: lesson.steering?.per_generation_objective,
  })
}

// ── blueprint ────────────────────────────────────────────────────────

async function generateBlueprint(projectSlug, lessonId, llmConfig) {
  const project = requireProject(projectSlug)
  const lesson = requireLesson(projectSlug, lessonId)
  if (lesson.status === 'drafted') {
    throw validation('This lesson already has text. Create a new lesson to start over.')
  }

  const { text, totalChars } = loadSources(projectSlug, lesson.sources)
  assertWithinCap(totalChars)

  const ctx = buildLessonContext(project, lesson, text)
  const parsed = await generateValidated({
    key: 'lesson-blueprint',
    schema: blueprintSchema,
    userPrompt: blueprintPrompt(ctx, { topic: lesson.topic, budget: lesson.time_budget_minutes }),
    llmConfig,
    maxTokens: BLUEPRINT_MAX_TOKENS,
  })

  // Order: hook, chunks, apply, then recall by day. Ids are reassigned in
  // that order so they are always unique and predictable.
  const ordered = [
    ...parsed.sections.filter(s => s.kind !== 'recall'),
    ...parsed.sections.filter(s => s.kind === 'recall').sort((a, b) => a.recall_day - b.recall_day),
  ]
  lesson.objective = str(parsed.objective)
  lesson.blueprint = {
    sections: ordered.map((s, i) => ({
      id: `s${i + 1}`,
      kind: s.kind,
      title: str(s.title),
      purpose: str(s.purpose),
      target_minutes: clampMinutes(s.target_minutes),
      ...(s.kind === 'recall' ? { recall_day: s.recall_day } : {}),
      source_refs: (Array.isArray(s.source_refs) ? s.source_refs : [])
        .filter(r => lesson.sources.includes(r)),
    })),
  }
  lesson.status = 'blueprint'
  store.writeLesson(projectSlug, lesson)
  return presentLesson(projectSlug, lesson)
}

// Edit the blueprint. You may change the objective, title, time budget,
// learner context, and each section's title, purpose, and minutes, and you
// may remove sections. Adding sections is not supported in v1.
// Any edit returns the lesson to "blueprint"; approve:true approves it.
function editBlueprint(projectSlug, lessonId, body) {
  requireProject(projectSlug)
  const lesson = requireLesson(projectSlug, lessonId)
  if (lesson.status === 'drafted') {
    throw validation('The lesson text is already written, so the blueprint is locked.')
  }
  if (!lesson.blueprint) throw validation('Generate the blueprint first.')

  if (body.title !== undefined) {
    const title = str(body.title)
    if (!title) throw validation('The lesson needs a title.')
    lesson.title = title.slice(0, 120)
  }
  if (body.objective !== undefined) {
    const objective = str(body.objective)
    if (!objective) throw validation('The lesson needs an objective.')
    lesson.objective = objective
  }
  if (body.time_budget_minutes !== undefined) {
    lesson.time_budget_minutes = clampBudget(body.time_budget_minutes)
  }
  if (body.context && typeof body.context === 'object') {
    const c = body.context
    lesson.context = {
      role: c.role !== undefined ? str(c.role) : lesson.context.role,
      experience: c.experience !== undefined ? experienceOrEmpty(c.experience) : lesson.context.experience,
      useCase: c.useCase !== undefined ? str(c.useCase) : lesson.context.useCase,
      learningObjectives: c.learningObjectives !== undefined
        ? str(c.learningObjectives) : lesson.context.learningObjectives,
    }
  }

  if (Array.isArray(body.sections)) {
    const current = lesson.blueprint.sections
    const byId = new Map(current.map(s => [s.id, s]))
    const edits = new Map()
    for (const edit of body.sections) {
      const cur = byId.get(edit?.id)
      if (!cur) throw validation(`Section "${edit?.id}" does not exist.`)
      if (edits.has(cur.id)) throw validation('A section was listed twice.')
      const title = edit.title !== undefined ? str(edit.title) : cur.title
      const purpose = edit.purpose !== undefined ? str(edit.purpose) : cur.purpose
      if (!title || !purpose) throw validation('Every section needs a title and a purpose.')
      edits.set(cur.id, {
        ...cur,
        title,
        purpose,
        target_minutes: edit.target_minutes !== undefined
          ? clampMinutes(edit.target_minutes) : cur.target_minutes,
      })
    }
    // Keep the original order; sections left out of the request are removed.
    const kept = current.filter(s => edits.has(s.id)).map(s => edits.get(s.id))
    const has = kind => kept.some(s => s.kind === kind)
    if (!has('hook') || !has('chunk') || !has('apply')) {
      throw validation('A lesson needs at least a hook, one chunk, and an apply section.')
    }
    lesson.blueprint.sections = kept
  }

  lesson.status = body.approve === true ? 'approved' : 'blueprint'
  store.writeLesson(projectSlug, lesson)
  return presentLesson(projectSlug, lesson)
}

// ── text ─────────────────────────────────────────────────────────────

// Turn the model's blocks + placements into the lesson's block list:
// text blocks in blueprint order with proposed artifact blocks inserted
// after the section they were proposed for, then the recall blocks.
function buildBlocks(lesson, parsed) {
  const sections = lesson.blueprint.sections
  const byId = new Map(parsed.blocks.map(b => [b.section_id, b]))

  const missing = sections.filter(s => !byId.has(s.id)).map(s => s.id)
  if (missing.length) {
    throw new SchemaValidationError('lesson-text', [
      { message: `The model wrote no text for sections: ${missing.join(', ')}` },
    ])
  }

  const refs = list => (Array.isArray(list) ? list : []).filter(r => lesson.sources.includes(r))

  const toBlock = section => {
    const m = byId.get(section.id)
    const block = {
      kind: section.kind,
      title: section.title,
      body: str(m.body),
      source_refs: refs(m.source_refs),
      edited: false,
    }
    if (section.kind === 'chunk') block.visual = str(m.visual)
    if (section.kind === 'recall') {
      block.recall_day = section.recall_day
      block.answer = str(m.answer)
    }
    return { sectionId: section.id, block }
  }

  const textBlocks = sections.filter(s => s.kind !== 'recall').map(toBlock)
  const recallBlocks = sections
    .filter(s => s.kind === 'recall')
    .sort((a, b) => a.recall_day - b.recall_day)
    .map(toBlock)

  // Proposed artifacts, grouped by the section they follow. An unknown
  // anchor falls back to the last text block.
  const anchors = new Set(textBlocks.map(t => t.sectionId))
  const lastAnchor = textBlocks[textBlocks.length - 1]?.sectionId
  const proposals = new Map()
  for (const p of parsed.placements) {
    const anchor = anchors.has(p.after_section) ? p.after_section : lastAnchor
    if (!proposals.has(anchor)) proposals.set(anchor, [])
    proposals.get(anchor).push(
      p.artifact_type === 'tabs'
        ? { kind: 'tabs', state: 'proposed', title: '', tabs: [], placement_note: str(p.note), edited: false }
        : { kind: 'artifact', artifact_type: p.artifact_type, state: 'proposed', placement_note: str(p.note), ref: null }
    )
  }

  const ordered = []
  for (const t of textBlocks) {
    ordered.push(t.block)
    for (const a of proposals.get(t.sectionId) || []) ordered.push(a)
  }
  for (const r of recallBlocks) ordered.push(r.block)

  return ordered.map((b, i) => ({ id: `b${i + 1}`, ...b }))
}

async function generateText(projectSlug, lessonId, llmConfig) {
  const project = requireProject(projectSlug)
  const lesson = requireLesson(projectSlug, lessonId)
  if (lesson.status === 'drafted') throw validation('This lesson already has text.')
  if (lesson.status !== 'approved') throw validation('Approve the blueprint before writing the lesson.')

  const { text, totalChars } = loadSources(projectSlug, lesson.sources)
  assertWithinCap(totalChars)

  const ctx = buildLessonContext(project, lesson, text)
  const parsed = await generateValidated({
    key: 'lesson-text',
    schema: textSchema,
    userPrompt: textPrompt(ctx, {
      topic: lesson.topic,
      objective: lesson.objective,
      blueprint: lesson.blueprint,
      budget: lesson.time_budget_minutes,
    }),
    llmConfig,
    maxTokens: TEXT_MAX_TOKENS,
  })

  lesson.blocks = buildBlocks(lesson, parsed)
  lesson.status = 'drafted'
  store.writeLesson(projectSlug, lesson)
  return presentLesson(projectSlug, lesson)
}

// ── blocks: placements, tabs, insert, remove ────────────────────────

// The nearest earlier block that has a title, so a prompt can say "after the
// section X". Artifact blocks and untitled blocks are skipped.
function nearestTitledBlock(lesson, blockId) {
  const idx = lesson.blocks.findIndex(b => b.id === blockId)
  for (let i = idx - 1; i >= 0; i--) {
    const b = lesson.blocks[i]
    if (b.kind !== 'artifact' && b.title) return b
  }
  return null
}

// Where a block sits in the lesson, in words. It becomes the "Placement"
// line of the BLOCK CONTEXT section.
function placementText(lesson, blockId, noun, note) {
  const before = nearestTitledBlock(lesson, blockId)
  return [
    `This ${noun} will be inserted into a lesson on "${lesson.topic}"` +
      (before ? `, after the section "${before.title}"` : '') + '.',
    note ? `Why it belongs there: ${note}` : '',
    'Keep it focused on the lesson objective, and keep it short enough for a lesson of ' +
      `${lesson.time_budget_minutes} minutes or less.`,
  ].filter(Boolean).join(' ')
}

// The user's context for THIS block. If the request carries none, a
// regenerate reuses what the block stored; an explicit (even empty)
// context replaces it.
function contextFor(type, block, body) {
  return body.context !== undefined
    ? sanitizeGenerationContext(type, body.context)
    : (block.generation_context || {})
}

// Kept on the block so Regenerate can reuse it and the user can edit it.
function storeContext(block, given) {
  if (Object.keys(given).length) block.generation_context = given
  else delete block.generation_context
}

// An experience override applies to one generation only; the lesson's own
// level is unchanged.
function learnerContextFor(lesson, given) {
  return given.experience ? { ...lesson.context, experience: given.experience } : lesson.context
}

// Generate a NEW artifact for an artifact block and save it in the primary
// source's folder. Returns the reference and the context that was used. It
// does not touch the lesson; the caller decides when to save.
async function generateArtifactFor(projectSlug, project, lesson, block, body, llmConfig) {
  const typeModule = getTypeModule(block.artifact_type)
  if (!typeModule) throw validation('That artifact type is not supported.')

  const { text, totalChars } = loadSources(projectSlug, lesson.sources)
  assertWithinCap(totalChars)

  const given = contextFor(block.artifact_type, block, body)
  const promptContext = buildPromptContext({
    sourceContent: text,
    context: learnerContextFor(lesson, given),
    project,
    perGenerationPrompt: lesson.steering?.per_generation_prompt,
    perGenerationObjective: lesson.objective,
    blockContext: {
      placement: placementText(lesson, block.id, 'artifact', block.placement_note),
      focus: given.focus,
      sourceSection: given.source_section,
      notes: given.notes,
    },
  })

  const primary = lesson.sources[0]
  const result = await typeModule.generate({
    promptContext,
    extras: extrasFor(block.artifact_type, given.count),
    sourceDir: store.sourceDirPath(projectSlug, primary),
    llmConfig,
  })
  return { ref: { source: primary, artifact: result.folder }, given }
}

// Point an artifact block at an artifact that already exists in the project.
function pointAtExisting(projectSlug, block, body) {
  const { source, artifact } = body
  const found = store.readArtifact(projectSlug, source, artifact)
  if (!found) throw notFound('That artifact could not be found in this project.')
  if ((found.type || 'flip-card-deck') !== block.artifact_type) {
    throw validation('Pick an artifact of the same type as this slot.')
  }
  if (block.ref && block.ref.source === source && block.ref.artifact === artifact) {
    throw validation('This lesson already uses that artifact. Pick a different one.')
  }
  block.ref = { source, artifact }
  // The old context described the artifact that was there before, so it no
  // longer applies. Regenerate on this block starts from an empty panel.
  delete block.generation_context
}

// Fill an artifact block: accept a proposal, or REPLACE what the block
// already holds (a working artifact or an orphaned reference).
//
//   mode "existing"  point the block at an artifact already in the project
//   mode "new"       generate a new artifact for this lesson, saved in the
//                    primary source's folder
//
// Replacing only changes the block's reference. The artifact it held
// before is never touched: its files stay where they are, it stays in the
// project, and it is still offered by the picker. If generation fails,
// the block keeps what it had.
async function acceptPlacement(projectSlug, lessonId, blockId, body, llmConfig) {
  const project = requireProject(projectSlug)
  const lesson = requireLesson(projectSlug, lessonId)
  if (lesson.status !== 'drafted') throw validation('Write the lesson text first.')

  const block = lesson.blocks.find(b => b.id === blockId)
  if (!block || block.kind !== 'artifact') throw notFound('That artifact slot was not found.')

  const mode = body?.mode
  if (mode === 'existing') {
    pointAtExisting(projectSlug, block, body)
  } else if (mode === 'new') {
    const { ref, given } = await generateArtifactFor(projectSlug, project, lesson, block, body, llmConfig)
    block.ref = ref
    storeContext(block, given)
  } else {
    throw validation('Choose to generate a new artifact or pick an existing one.')
  }

  block.state = 'ready'
  store.writeLesson(projectSlug, lesson)
  return presentLesson(projectSlug, lesson)
}

// ── tabs ─────────────────────────────────────────────────────────────

const TAB_LIMITS = { min: 2, max: 5, label: 40, body: 1500, visual: 300, title: 120 }

// Validate and normalize a tabs payload. strict (user input) rejects bad
// values with a friendly message; non-strict (model output) trims instead.
// Existing tab ids are kept; new tabs get the next free "t<n>".
function sanitizeTabs(rawTabs, rawTitle, { strict }) {
  if (!Array.isArray(rawTabs) || rawTabs.length < TAB_LIMITS.min || rawTabs.length > TAB_LIMITS.max) {
    throw validation(`A tabs block needs ${TAB_LIMITS.min} to ${TAB_LIMITS.max} tabs.`)
  }
  const reserved = new Set()
  for (const t of rawTabs) {
    if (t && typeof t.id === 'string' && /^t\d+$/.test(t.id)) reserved.add(t.id)
  }
  const assigned = new Set()
  let counter = 0
  const freshId = () => {
    do { counter += 1 } while (reserved.has(`t${counter}`) || assigned.has(`t${counter}`))
    return `t${counter}`
  }

  const tabs = rawTabs.map(t => {
    let label = str(t?.label)
    let body = str(t?.body)
    let visual = str(t?.visual)
    if (strict) {
      if (!label) throw validation('Every tab needs a label.')
      if (label.length > TAB_LIMITS.label) throw validation(`Tab labels can be up to ${TAB_LIMITS.label} characters.`)
      if (!body) throw validation(`The tab "${label}" needs some text.`)
      if (body.length > TAB_LIMITS.body) throw validation(`The tab "${label}" is too long. Keep each tab under 1,500 characters.`)
      if (visual.length > TAB_LIMITS.visual) throw validation(`The visual note on "${label}" can be up to ${TAB_LIMITS.visual} characters.`)
    } else {
      label = label.slice(0, TAB_LIMITS.label)
      body = body.slice(0, TAB_LIMITS.body)
      visual = visual.slice(0, TAB_LIMITS.visual)
    }
    let id = t && typeof t.id === 'string' && reserved.has(t.id) && !assigned.has(t.id) ? t.id : freshId()
    assigned.add(id)
    return visual ? { id, label, body, visual } : { id, label, body }
  })
  return { title: str(rawTitle).slice(0, TAB_LIMITS.title), tabs }
}

// A comparable snapshot, so a save that changes nothing does not flag the
// block as edited.
const tabsSnapshot = block => JSON.stringify({
  title: block.title || '',
  tabs: (block.tabs || []).map(t => ({ id: t.id, label: t.label, body: t.body, visual: t.visual || '' })),
})

async function writeTabsWithModel(projectSlug, project, lesson, block, body, llmConfig) {
  const { text, totalChars } = loadSources(projectSlug, lesson.sources)
  assertWithinCap(totalChars)

  const given = contextFor('tabs', block, body)
  const promptContext = buildPromptContext({
    sourceContent: text,
    context: learnerContextFor(lesson, given),
    project,
    perGenerationPrompt: lesson.steering?.per_generation_prompt,
    perGenerationObjective: lesson.objective,
    blockContext: {
      placement: placementText(lesson, block.id, 'tabs block', block.placement_note),
      focus: given.focus,
      sourceSection: given.source_section,
      notes: given.notes,
    },
  })

  const parsed = await generateValidated({
    key: 'lesson-tabs',
    schema: tabsSchema,
    userPrompt: tabsPrompt(promptContext, {
      topic: lesson.topic,
      objective: lesson.objective,
      count: given.count,
    }),
    llmConfig,
    maxTokens: TABS_MAX_TOKENS,
  })
  return { ...sanitizeTabs(parsed.tabs, parsed.title, { strict: false }), given }
}

// Generate the tabs for a proposed tabs block, or regenerate a ready one.
// Regenerating over hand edits needs overwrite:true, so a stray request
// cannot silently discard the user's work.
async function generateTabs(projectSlug, lessonId, blockId, body, llmConfig) {
  const project = requireProject(projectSlug)
  const lesson = requireLesson(projectSlug, lessonId)
  if (lesson.status !== 'drafted') throw validation('Write the lesson text first.')

  const block = lesson.blocks.find(b => b.id === blockId)
  if (!block || block.kind !== 'tabs') throw notFound('That tabs block was not found.')
  if (block.state === 'ready' && block.edited && body?.overwrite !== true) {
    throw validation('This tabs block has your edits. Confirm that you want to replace them.')
  }

  const out = await writeTabsWithModel(projectSlug, project, lesson, block, body || {}, llmConfig)
  block.title = out.title
  block.tabs = out.tabs
  block.state = 'ready'
  block.edited = false
  storeContext(block, out.given)
  store.writeLesson(projectSlug, lesson)
  return presentLesson(projectSlug, lesson)
}

// Edit a tabs block inline: labels, bodies, visual notes, and the number
// and order of tabs. A proposed block that is written by hand becomes
// ready. Any real change marks the block as edited.
function editTabs(projectSlug, lessonId, blockId, body) {
  requireProject(projectSlug)
  const lesson = requireLesson(projectSlug, lessonId)
  const block = lesson.blocks.find(b => b.id === blockId)
  if (!block || block.kind !== 'tabs') throw notFound('That tabs block was not found.')

  const clean = sanitizeTabs(body?.tabs, body?.title, { strict: true })
  const wasProposed = block.state === 'proposed'
  const before = tabsSnapshot(block)
  block.title = clean.title
  block.tabs = clean.tabs
  block.state = 'ready'
  if (wasProposed || tabsSnapshot(block) !== before) block.edited = true

  store.writeLesson(projectSlug, lesson)
  return presentLesson(projectSlug, lesson)
}

// ── insert ───────────────────────────────────────────────────────────

function nextBlockId(lesson) {
  let max = 0
  for (const b of lesson.blocks) {
    const m = /^b(\d+)$/.exec(b.id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `b${max + 1}`
}

// Insert a new block AFTER an existing block. Recall prompts come last, so
// nothing is inserted after one. The hook stays first, so nothing is
// inserted before it.
//
//   kind "tabs"      mode "write"     the user supplies title + tabs
//                    mode "generate"  Byte writes them (optional context)
//   kind "artifact"  mode "existing"  point at an artifact in the project
//                    mode "new"       generate one (optional context)
//
// Nothing is saved unless the whole insert succeeds.
async function insertBlock(projectSlug, lessonId, body, llmConfig) {
  const project = requireProject(projectSlug)
  const lesson = requireLesson(projectSlug, lessonId)
  if (lesson.status !== 'drafted') throw validation('Write the lesson text first.')

  const after = lesson.blocks.findIndex(b => b.id === body?.after)
  if (after === -1) throw notFound('Pick where to insert the block.')
  if (lesson.blocks[after].kind === 'recall') {
    throw validation('Blocks cannot be inserted after the recall prompts.')
  }

  const mode = body.mode
  let block
  if (body.kind === 'tabs') {
    block = { id: nextBlockId(lesson), kind: 'tabs', state: 'ready', title: '', tabs: [], edited: false }
    lesson.blocks.splice(after + 1, 0, block)
    if (mode === 'write') {
      const clean = sanitizeTabs(body.tabs, body.title, { strict: true })
      block.title = clean.title
      block.tabs = clean.tabs
      block.edited = true
    } else if (mode === 'generate') {
      const out = await writeTabsWithModel(projectSlug, project, lesson, block, body, llmConfig)
      block.title = out.title
      block.tabs = out.tabs
      storeContext(block, out.given)
    } else {
      throw validation('Choose to write the tabs yourself or have Byte generate them.')
    }
  } else if (body.kind === 'artifact') {
    if (!getTypeModule(body.artifact_type)) throw validation('That artifact type is not supported.')
    block = {
      id: nextBlockId(lesson),
      kind: 'artifact',
      artifact_type: body.artifact_type,
      state: 'ready',
      placement_note: '',
      ref: null,
    }
    lesson.blocks.splice(after + 1, 0, block)
    if (mode === 'existing') {
      pointAtExisting(projectSlug, block, body)
    } else if (mode === 'new') {
      const { ref, given } = await generateArtifactFor(projectSlug, project, lesson, block, body, llmConfig)
      block.ref = ref
      storeContext(block, given)
    } else {
      throw validation('Choose to generate a new artifact or pick an existing one.')
    }
  } else {
    throw validation('Choose a tabs block or an artifact to insert.')
  }

  store.writeLesson(projectSlug, lesson)
  return presentLesson(projectSlug, lesson)
}

// Remove an artifact block or a tabs block from the lesson (proposed,
// ready, or orphaned). This takes the BLOCK out of the lesson and nothing
// else: an artifact's files are never deleted, it stays in the project,
// and it is still offered by the picker. Removing a proposed block is the
// same as dismissing it. Text blocks are removed through the lesson editor
// in a later phase.
function removeBlock(projectSlug, lessonId, blockId) {
  requireProject(projectSlug)
  const lesson = requireLesson(projectSlug, lessonId)
  const block = lesson.blocks.find(b => b.id === blockId)
  if (!block) throw notFound('That block was not found.')
  if (block.kind !== 'artifact' && block.kind !== 'tabs') {
    throw validation('Only artifact and tabs blocks can be removed for now.')
  }
  lesson.blocks = lesson.blocks.filter(b => b.id !== blockId)
  store.writeLesson(projectSlug, lesson)
  return presentLesson(projectSlug, lesson)
}

module.exports = {
  IN_LESSON_SIZES,
  listLessons,
  getLesson,
  createLesson,
  generateBlueprint,
  editBlueprint,
  generateText,
  acceptPlacement,
  generateTabs,
  editTabs,
  insertBlock,
  removeBlock,
}
