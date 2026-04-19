// routes/artifacts.js — Claude API generation pipeline (project-scoped)
//
// Mounted as a nested router under sources:
//   POST /api/projects/:projectSlug/sources/:sourceSlug/artifacts/generate
//
// mergeParams: true lets req.params carry both :projectSlug and :sourceSlug
// from the parent routers into this handler.

const express = require('express')
const router = express.Router({ mergeParams: true })
const fs = require('fs')
const path = require('path')
const os = require('os')
const Anthropic = require('@anthropic-ai/sdk')

const PROJECTS_DIR = path.join(os.homedir(), 'Byte', 'projects')
const SETTINGS_FILE = path.join(os.homedir(), 'Byte', 'settings.json')

// ─────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// Fixed for every Claude API call. Encodes Byte's secondary-content
// identity, the 2026 Modern Learning Design Principles, and the
// priority order between steering layers.
// ─────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the generative engine inside Byte, a tool for instructional
designers that creates bite-sized tapas-style learning artifacts from
source content.

CORE IDENTITY: SECONDARY CONTENT CREATOR

Byte does not create learning content from scratch. Byte creates
SECONDARY content from primary source material that an SME, designer,
or subject expert has already produced. Your job is to faithfully
distill, reframe, and transform that source material into bite-sized
learning artifacts. You are not an author of new ideas; you are a
skilled instructional translator who preserves the source's substance
while reshaping it for learner-friendly consumption.

This framing is fundamental. When source material is thin, do not fill
the gap with invented content. Instead, generate fewer, denser artifacts
that stay grounded in what the source actually contains. A tight
four-card flip deck grounded in the source beats a bloated ten-card
deck padded with generic content.

When source material conflicts with standard instructional practice,
favor the source's framing unless explicitly told otherwise. The source
reflects the SME's expertise. Byte's job is to make that expertise
accessible, not to override it.

STEERING LAYERS

Every generation receives three layers of steering in addition to the
source content and learner context:

  1. PROJECT STYLE GUIDE — how to write (voice, tone, writing rules)
  2. PROJECT CUSTOM INSTRUCTIONS — what to focus on (content emphasis,
     pedagogical angle, framing)
  3. PER-GENERATION PROMPT — one-off adjustments for this artifact only

Apply all three. If they conflict, prioritize in this order:
Per-Generation Prompt > Custom Instructions > Style Guide > 2026
Principles > your defaults.

LEARNING OBJECTIVES

You may receive learning objectives at two levels of specificity:

  1. A TARGET LEARNING OBJECTIVE for this specific artifact (locked).
     If provided, your artifact MUST address this objective exactly.
     Do not substitute a different objective. State it verbatim as
     the artifact's learning_objective in the response.

  2. SOURCE LEARNING OBJECTIVES — multiple objectives the source is
     designed to support. If provided, pick ONE that best fits the
     artifact type and the per-generation steering, and state the one
     you chose as the artifact's learning_objective.

  3. NONE PROVIDED. Infer a single tight objective from the source.

When objectives are provided, treat them as authoritative. A provided
objective overrides anything you might otherwise infer. This reflects
how professional instructional designers actually work: objectives come
first, content serves objectives.

2026 MODERN LEARNING DESIGN PRINCIPLES

Every artifact must follow these. Non-negotiable.

CORE PHILOSOPHY
Each artifact is a standalone, high-impact learning moment. One learning
objective per artifact, no exceptions. Assume learners have an attention
window under 60 seconds before context-switching. Design for interruption.

HOOK IN THE FIRST 30 SECONDS
Every artifact opens with a hook. Not a learning objective. Not an agenda.
Choose from: a decision the learner makes before knowing the answer, a
surprising or counterintuitive stat, a scenario where something already
went wrong, or a challenge that reveals a knowledge gap immediately.

COGNITIVE LOAD DISCIPLINE
Strip content to its core. Remove anything that does not directly serve
the single learning objective. Break information into small, manageable
chunks.

IMMEDIATE APPLICATION
Every artifact ends with one concrete thing the learner can do right now.
Not "remember this for later." Do this today.

ROLE-BASED CONTEXT
You will be given a learner role, experience level, and use-case urgency.
Tailor every artifact to that specific context. Use their language, their
daily friction points, and their real scenarios.

PROJECT STYLE GUIDE AND AUDIENCE
Every artifact is generated within a project. The project's style guide
governs voice; the target audience description sets the lens. Apply both
consistently. Style guide rules override your defaults.

GAMIFICATION WHERE APPLICABLE
When the artifact type supports it, include a gamification mechanic:
points, badges tied to demonstrated behavior, timed pressure, streaks,
or bonus unlocks.

VISUAL ANCHOR MANDATORY
Every artifact references at least one visual element: a diagram, a
decision tree, an illustrated scenario, or a visual metaphor. Describe
the visual clearly so the frontend can render or source it.

10-MINUTE MAX
If an artifact would take longer than 10 minutes to complete, suggest
splitting it into multiple artifacts.

SPACED REPETITION AWARENESS
Design artifacts so the same source content can be revisited through
different artifact types over time. Note when a specific card, question,
or scenario would benefit from being resurfaced as a different artifact
type later.

=== LEARNING STYLES AWARENESS ===
[Reserved for insights from 2026 Learning Styles research.
 Populate in a future phase. Do not fill in now.]
=================================

SOURCE FIDELITY RULES

When source material includes specific frameworks, terminology, diagrams,
or mental models, USE them. Do not invent parallel frameworks. If the
source says "the three pillars of X," your artifact references those
three pillars, not a different set.

When source material is ambiguous or contradictory, flag it in the
artifact's spaced_repetition_notes rather than resolving it silently.

When source material references visuals (charts, diagrams, screenshots)
that are not yet available to you, describe them precisely in the
visual_anchor_description so the user knows what the source referenced.

VISUAL CONSISTENCY WITH SOURCE

When source content includes available images (you will receive a text
list of them with nearby text context), reference those images by
filename whenever a visual anchor would help the card. Prefer existing
source images over describing invented visuals.

Byte is a secondary content creation tool. Consistency with the source
material is a feature. Using the actual diagrams, charts, and visuals
the SME created is almost always better than inventing new descriptions.

Rules for referencing source images:
  - Only reference filenames from the provided list. Never invent a
    filename that wasn't given to you.
  - Use the nearbyText metadata to pick the most relevant image for
    each card's content.
  - If no source image fits a particular card, set that card's
    visual_filename to null. Do not force a match.
  - visual_anchor_description still captures the ideal visual for the
    deck overall, independent of whether specific cards use specific
    source images.

When images are unavailable (manifest is empty), continue generating
without source image references. visual_filename should be null for
every card in that case.

OUTPUT FORMAT
Respond only in valid JSON matching the schema for the requested
artifact type. No preamble, no markdown fences, no commentary.`

// ─────────────────────────────────────────────────────────────────
// Manifest → text formatter.
//
// Converts media/manifest.json's images array into the human-readable
// block we show Claude. Keeps sourcePosition verbatim from the
// extractors ("slide N" / "page N" / "after paragraph N") so the
// rendering matches the source format without extra bookkeeping.
// Empty manifest renders as "(none available)" so Claude has an
// unambiguous "no images here" signal rather than a missing section.
// ─────────────────────────────────────────────────────────────────
function formatImageManifest(manifest) {
  const images = Array.isArray(manifest?.images) ? manifest.images : []
  if (images.length === 0) return '(none available)'
  return images.map(img => {
    const filename = img.filename || '(unknown)'
    const position = img.sourcePosition || 'unknown position'
    const nearby = (img.nearbyText || '').trim()
    const nearbyFragment = nearby ? `, near text: "${nearby}"` : ''
    return `- ${filename} (${position}${nearbyFragment})`
  }).join('\n')
}

// ─────────────────────────────────────────────────────────────────
// PROMPT BUILDER — Flip Card Deck
//
// The user message always renders every section header — even when
// the value is "(none provided)". This is a deliberate design choice:
// an empty section signals to Claude that the absence is intentional,
// not missing context, so it does not attempt to fill the gap by
// inferring what the project guidelines might be.
// ─────────────────────────────────────────────────────────────────
function buildFlipCardPrompt(sourceContent, context, project, perGenerationPrompt, perGenerationObjective, imageManifestBlock) {
  // Pick the objective block based on priority:
  //   per-generation override > source objectives > infer
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

  return `Generate a flip card deck from the following source content. This is \
SECONDARY content creation: treat the source as reference material to \
faithfully distill, not as inspiration for invention.

═══ PROJECT STYLE GUIDE ═══
${project.styleGuide?.trim() || '(none provided)'}

═══ PROJECT TARGET AUDIENCE ═══
${project.targetAudience?.trim() || '(none provided)'}

═══ PROJECT CUSTOM INSTRUCTIONS ═══
${project.customInstructions?.trim() || '(none provided)'}

═══ PER-GENERATION PROMPT ═══
${perGenerationPrompt?.trim() || '(none provided)'}

═══ LEARNER CONTEXT ═══
Role: ${context.role || 'not specified'}
Experience level: ${context.experience || 'not specified'}
Use case: ${context.useCase || 'not specified'}

═══ LEARNING OBJECTIVES ═══
${objectivesBlock}

═══ SOURCE CONTENT (reference material) ═══
${sourceContent}

═══ AVAILABLE SOURCE IMAGES ═══
${imageManifestBlock}

═══ REQUIREMENTS ═══
- Distill the source. Do not invent content beyond what the source supports.
- If the source is thin, produce a tighter deck (4-6 cards) rather than
  padding with generic content to hit a target count.
- If the source is rich, produce a fuller deck (6-10 cards).
- One learning objective for the full deck. State it at the top.
- Open with a hook card: a decision, stat, or challenge grounded in the
  source material that pulls the learner in before they know the answer.
- Each content card: front is a question, key term, or decision point
  drawn from the source; back is the answer or insight, stripped to its
  core, in the project's voice.
- Final card is an "Apply today" card: one specific action the learner
  can take right now, grounded in the source's actual content.
- Use the source's own frameworks, terminology, and examples. Do not
  substitute your own.
- Suggest one visual anchor for the deck, describing it precisely enough
  that it could be sketched.
- Estimate completion time in minutes.
- If the source is too thin to support the full requirements, produce
  your best distillation and note the gap in spaced_repetition_notes.

Respond in this JSON schema:
{
  "learning_objective": "string",
  "estimated_minutes": number,
  "visual_anchor_description": "string",
  "cards": [
    {
      "type": "hook | content | apply",
      "front": "string",
      "back": "string",
      "visual_filename": "string | null — filename from AVAILABLE SOURCE IMAGES, or null when no source image fits"
    }
  ],
  "spaced_repetition_notes": "string describing which cards would benefit from resurfacing as a different artifact type later, and flagging any gaps or ambiguities in the source material"
}`
}

// ─────────────────────────────────────────────────────────────────
// POST .../artifacts/generate
// ─────────────────────────────────────────────────────────────────
router.post('/generate', async (req, res) => {
  const { projectSlug, sourceSlug } = req.params
  const { artifactType, perGenerationPrompt, perGenerationObjective } = req.body

  if (!artifactType) {
    return res.status(400).json({ error: 'artifactType is required' })
  }
  if (artifactType !== 'flip-card-deck') {
    return res.status(400).json({
      error: `Artifact type "${artifactType}" is not supported in this version.`
    })
  }

  if (!fs.existsSync(SETTINGS_FILE)) {
    return res.status(400).json({
      error: 'No API key found. Go to Settings and paste your Anthropic API key.'
    })
  }
  const { apiKey } = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
  if (!apiKey) {
    return res.status(400).json({
      error: 'API key is empty. Go to Settings and paste your Anthropic API key.'
    })
  }

  const sourceDir = path.join(PROJECTS_DIR, projectSlug, 'sources', sourceSlug)
  if (!fs.existsSync(sourceDir)) {
    return res.status(404).json({ error: 'Source not found' })
  }

  const mdPath = path.join(sourceDir, 'source.md')
  const sourceContent = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf-8') : ''

  // Older sources may lack learningObjectives — read tolerates missing keys.
  const ctxPath = path.join(sourceDir, 'context.json')
  const context = fs.existsSync(ctxPath)
    ? JSON.parse(fs.readFileSync(ctxPath, 'utf-8'))
    : {}

  // Older projects may lack customInstructions — read tolerates missing keys.
  const projectPath = path.join(PROJECTS_DIR, projectSlug, 'project.json')
  const project = fs.existsSync(projectPath)
    ? JSON.parse(fs.readFileSync(projectPath, 'utf-8'))
    : {}

  // Image manifest from the extracted source media. Older sources (or
  // pasted-text sources with no media step) may be missing this file
  // entirely; an empty manifest is the safe fallback.
  const manifestPath = path.join(sourceDir, 'media', 'manifest.json')
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    : { images: [] }
  const imageManifestBlock = formatImageManifest(manifest)

  const userPrompt = buildFlipCardPrompt(
    sourceContent,
    context,
    project,
    perGenerationPrompt,
    perGenerationObjective,
    imageManifestBlock
  )

  const anthropic = new Anthropic({ apiKey })

  let claudeResponse
  try {
    claudeResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    })
  } catch (apiError) {
    console.error('Claude API error:', apiError)
    return res.status(500).json({
      error: `Claude API error: ${apiError.message || 'Unknown error. Check your API key.'}`
    })
  }

  const rawText = claudeResponse.content[0].text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  let artifact
  try {
    artifact = JSON.parse(rawText)
  } catch {
    console.error('Failed to parse Claude response as JSON:', rawText)
    return res.status(500).json({
      error: 'Claude returned a response that could not be parsed as JSON. Please try again.',
      raw: rawText.slice(0, 500)
    })
  }

  // Validate any filenames Claude referenced. Claude occasionally
  // hallucinates filenames even when given an explicit list; rather than
  // letting the renderer 404 on a broken link, we null out unknown
  // filenames and annotate valid ones with their sourcePosition so the
  // frontend can display "Source: slide 3" without re-fetching the
  // manifest.
  const manifestByFilename = new Map(
    (Array.isArray(manifest.images) ? manifest.images : [])
      .map(img => [img.filename, img])
  )
  if (Array.isArray(artifact.cards)) {
    artifact.cards.forEach((card, idx) => {
      if (!card || !card.visual_filename) return
      const entry = manifestByFilename.get(card.visual_filename)
      if (!entry) {
        console.warn(
          `[generation] Claude referenced non-existent filename: ${card.visual_filename} for card ${idx}, setting to null`
        )
        card.visual_filename = null
      } else {
        card.visual_source_position = entry.sourcePosition
      }
    })
  }

  const timestamp = Date.now()
  const folderName = `flip-cards-${timestamp}`
  const artifactDir = path.join(sourceDir, 'artifacts', folderName)
  fs.mkdirSync(artifactDir, { recursive: true })
  fs.writeFileSync(path.join(artifactDir, 'artifact.json'), JSON.stringify(artifact, null, 2))

  res.json({ folder: folderName, ...artifact })
})

module.exports = router
