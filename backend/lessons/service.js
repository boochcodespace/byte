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
const { blueprintPrompt, textPrompt } = require('./prompts')
const { validation, notFound } = require('./errors')
const blueprintSchema = require('./schemas/blueprint.schema.json')
const textSchema = require('./schemas/text.schema.json')

const DEFAULT_BUDGET = 10
const MIN_BUDGET = 5
const MAX_BUDGET = 10

const BLUEPRINT_MAX_TOKENS = 3000
const TEXT_MAX_TOKENS = 6500

// In-lesson artifact sizes. Standalone defaults are larger; these keep a
// lesson with a few artifacts inside its time budget.
const IN_LESSON_EXTRAS = {
  'flip-card-deck': { maxCards: 4 },
  'knowledge-check': { maxItems: 3 },
  'scenario-branching': { minDecisions: 2, maxDecisions: 2 },
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
  return { lesson: computed, artifacts }
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
    proposals.get(anchor).push({
      kind: 'artifact',
      artifact_type: p.artifact_type,
      state: 'proposed',
      placement_note: str(p.note),
      ref: null,
    })
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

// ── placements ───────────────────────────────────────────────────────

// A block can take an artifact when it is still a proposal, or when its
// reference no longer resolves (the orphan case).
function canReceiveArtifact(projectSlug, block) {
  if (block.state === 'proposed' || !block.ref) return true
  return !store.readArtifact(projectSlug, block.ref.source, block.ref.artifact)
}

function nearestTextBlock(lesson, blockId) {
  const idx = lesson.blocks.findIndex(b => b.id === blockId)
  for (let i = idx - 1; i >= 0; i--) {
    if (lesson.blocks[i].kind !== 'artifact') return lesson.blocks[i]
  }
  return null
}

async function acceptPlacement(projectSlug, lessonId, blockId, body, llmConfig) {
  const project = requireProject(projectSlug)
  const lesson = requireLesson(projectSlug, lessonId)
  if (lesson.status !== 'drafted') throw validation('Write the lesson text first.')

  const block = lesson.blocks.find(b => b.id === blockId)
  if (!block || block.kind !== 'artifact') throw notFound('That artifact slot was not found.')
  if (!canReceiveArtifact(projectSlug, block)) {
    throw validation('This slot already has an artifact.')
  }

  const mode = body?.mode
  const primary = lesson.sources[0]

  if (mode === 'existing') {
    const source = body.source
    const artifact = body.artifact
    const found = store.readArtifact(projectSlug, source, artifact)
    if (!found) throw notFound('That artifact could not be found in this project.')
    const foundType = found.type || 'flip-card-deck'
    if (foundType !== block.artifact_type) {
      throw validation('Pick an artifact of the same type as this slot.')
    }
    block.ref = { source, artifact }
  } else if (mode === 'new') {
    const typeModule = getTypeModule(block.artifact_type)
    if (!typeModule) throw validation('That artifact type is not supported.')

    const { text, totalChars } = loadSources(projectSlug, lesson.sources)
    assertWithinCap(totalChars)

    const before = nearestTextBlock(lesson, blockId)
    const placement = [
      `This artifact will be inserted into a lesson on "${lesson.topic}"` +
        (before ? `, after the section "${before.title}"` : '') + '.',
      block.placement_note ? `Why it belongs there: ${block.placement_note}` : '',
      'Keep it focused on the lesson objective, and keep it short enough for a lesson of ' +
        `${lesson.time_budget_minutes} minutes or less.`,
    ].filter(Boolean).join(' ')
    const steering = [lesson.steering?.per_generation_prompt, placement].filter(Boolean).join('\n')

    const promptContext = buildPromptContext({
      sourceContent: text,
      context: lesson.context,
      project,
      perGenerationPrompt: steering,
      perGenerationObjective: lesson.objective,
    })

    const result = await typeModule.generate({
      promptContext,
      extras: IN_LESSON_EXTRAS[block.artifact_type] || {},
      sourceDir: store.sourceDirPath(projectSlug, primary),
      llmConfig,
    })
    block.ref = { source: primary, artifact: result.folder }
  } else {
    throw validation('Choose to generate a new artifact or pick an existing one.')
  }

  block.state = 'ready'
  store.writeLesson(projectSlug, lesson)
  return presentLesson(projectSlug, lesson)
}

// For now only a PROPOSED artifact can be dismissed. Other blocks are
// removed through the lesson editor in a later phase.
function dismissBlock(projectSlug, lessonId, blockId) {
  requireProject(projectSlug)
  const lesson = requireLesson(projectSlug, lessonId)
  const block = lesson.blocks.find(b => b.id === blockId)
  if (!block) throw notFound('That block was not found.')
  if (block.kind !== 'artifact' || block.state !== 'proposed') {
    throw validation('Only a proposed artifact can be dismissed for now.')
  }
  lesson.blocks = lesson.blocks.filter(b => b.id !== blockId)
  store.writeLesson(projectSlug, lesson)
  return presentLesson(projectSlug, lesson)
}

module.exports = {
  IN_LESSON_EXTRAS,
  listLessons,
  getLesson,
  createLesson,
  generateBlueprint,
  editBlueprint,
  generateText,
  acceptPlacement,
  dismissBlock,
}
