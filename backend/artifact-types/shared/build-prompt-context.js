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
    steeringBlock: renderSteeringBlock(project, perGenerationPrompt),
    learnerContextBlock: renderLearnerContextBlock(context),
    objectivesBlock,
  }
}

// The steering block renders the three project-level layers plus the
// per-generation prompt. Ordering matches the system prompt's priority
// enumeration so the visual structure reinforces the rules.
function renderSteeringBlock(project, perGenerationPrompt) {
  return [
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
  ].join('\n')
}

function renderLearnerContextBlock(context) {
  return [
    `═══ LEARNER CONTEXT ═══`,
    `Role: ${context.role || 'not specified'}`,
    `Experience level: ${context.experience || 'not specified'}`,
    `Use case: ${context.useCase || 'not specified'}`,
  ].join('\n')
}

module.exports = { buildPromptContext }
