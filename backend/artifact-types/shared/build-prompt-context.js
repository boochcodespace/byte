// artifact-types/shared/build-prompt-context.js
//
// Assembles the block of prompt context that is common to every
// artifact type: the three steering layers, learner context, and the
// learning-objectives block with its priority logic.
//
// Each artifact-type module receives the resulting struct in its
// promptTemplate(ctx, extras) call. Types interpolate these blocks
// into their type-specific user message. This is where the common
// rules live; touching the three-layer steering or objectives
// priority happens here, not per-type.
//
// Every section is rendered even when empty (as "(none provided)" or
// a "not specified" literal). That is deliberate: an empty section
// tells Claude the absence is intentional and that it should not
// guess at project context that wasn't provided.

function buildPromptContext({
  sourceContent,
  context = {},
  project = {},
  perGenerationPrompt = '',
  perGenerationObjective = '',
  blockContext = null,
}) {
  // Objective block follows the priority in the system prompt:
  //   per-generation override > source objectives list > infer
  let objectivesBlock
  if (perGenerationObjective && perGenerationObjective.trim()) {
    objectivesBlock = `TARGET LEARNING OBJECTIVE (locked for this artifact — use verbatim as learning_objective):
${perGenerationObjective.trim()}`
  } else if (context.learningObjectives && context.learningObjectives.trim()) {
    objectivesBlock = `SOURCE LEARNING OBJECTIVES (pick the most relevant one for this artifact and state which you chose):
${context.learningObjectives.trim()}`
  } else {
    objectivesBlock = `(none provided — infer a single tight objective from the source)`
  }

  return {
    sourceContent: sourceContent || '',
    steeringBlock: renderSteeringBlock(project, perGenerationPrompt, blockContext),
    learnerContextBlock: renderLearnerContextBlock(context),
    objectivesBlock,
  }
}

// The steering block renders the three project-level layers plus the
// per-generation prompt. Ordering matches the system prompt's priority
// enumeration so the visual structure reinforces the rules.
//
// A generation inside a lesson also passes a blockContext: where the block
// sits, and any focus, source section, or notes the user set for that ONE
// block. It renders as its own section after the per-generation prompt,
// and only when given, so standalone artifact prompts are unchanged. The
// system prompt ranks it below the item writing rules and the style guide
// and above the project custom instructions (content focus only).
function renderSteeringBlock(project, perGenerationPrompt, blockContext) {
  const lines = [
    `═══ PROJECT STYLE GUIDE ═══`,
    project.styleGuide?.trim() || '(none provided)',
    ``,
    `═══ PROJECT TARGET AUDIENCE ═══`,
    project.targetAudience?.trim() || '(none provided)',
    ``,
    `═══ PROJECT CUSTOM INSTRUCTIONS ═══`,
    project.customInstructions?.trim() || '(none provided)',
    ``,
    `═══ PER-GENERATION PROMPT ═══`,
    perGenerationPrompt?.trim() || '(none provided)',
  ]
  if (blockContext) {
    lines.push('', `═══ BLOCK CONTEXT (this block only) ═══`)
    if (blockContext.placement) lines.push(`Placement: ${blockContext.placement}`)
    if (blockContext.focus) lines.push(`Focus: ${blockContext.focus}`)
    if (blockContext.sourceSection) lines.push(`Source section: ${blockContext.sourceSection}`)
    if (blockContext.notes) lines.push(`Notes: ${blockContext.notes}`)
  }
  return lines.join('\n')
}

// Experience level is Novice / Practicing / Expert. Sources saved before
// this rename hold the old four-level values; map them so existing
// sources keep working without a data migration.
const LEGACY_EXPERIENCE = {
  beginner: 'Novice',
  intermediate: 'Practicing',
  advanced: 'Practicing',
}

function normalizeExperience(value) {
  const key = (value || '').trim().toLowerCase()
  if (!key) return 'not specified'
  if (LEGACY_EXPERIENCE[key]) return LEGACY_EXPERIENCE[key]
  if (['novice', 'practicing', 'expert'].includes(key)) {
    return key.charAt(0).toUpperCase() + key.slice(1)
  }
  return 'not specified'
}

function renderLearnerContextBlock(context) {
  return [
    `═══ LEARNER CONTEXT ═══`,
    `Role: ${context.role || 'not specified'}`,
    `Experience level: ${normalizeExperience(context.experience)}`,
    `Use case: ${context.useCase || 'not specified'}`,
  ].join('\n')
}

module.exports = { buildPromptContext, normalizeExperience }
