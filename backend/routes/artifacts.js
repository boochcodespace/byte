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
// ─────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the generative engine inside Byte, a tool for instructional
designers that creates bite-sized tapas-style learning artifacts from
source content.

Every artifact you generate must follow these 2026 Modern Learning
Design Principles. These are non-negotiable rules.

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
Each source belongs to a project. The project may define a house style guide
and a target audience. When present, these take precedence over generic
defaults: match the tone, terminology, and complexity level specified. If
they conflict with learner context, prefer specificity — address both where
possible.

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

OUTPUT FORMAT
Respond only in valid JSON matching the schema for the requested
artifact type. No preamble, no markdown fences, no commentary.`

// ─────────────────────────────────────────────────────────────────
// PROMPT BUILDER — Flip Card Deck
// ─────────────────────────────────────────────────────────────────
function buildFlipCardPrompt(sourceContent, context, project) {
  return `Generate a flip card deck from the following source content.

PROJECT STYLE GUIDE:
${project.styleGuide || 'None specified.'}

PROJECT TARGET AUDIENCE:
${project.targetAudience || 'None specified.'}

LEARNER CONTEXT:
- Role: ${context.role || 'Not specified'}
- Experience level: ${context.experience || 'Not specified'}
- Use case: ${context.useCase || 'Not specified'}

SOURCE CONTENT:
${sourceContent}

REQUIREMENTS:
- 6 to 10 cards total
- One learning objective for the full deck (state it at the top)
- Open with a hook card: a decision, stat, or challenge that pulls
  the learner in before they know the answer
- Each card: front is a question, key term, or decision point;
  back is the answer or insight, stripped to its core
- Final card is an "Apply today" card: one specific action the
  learner can take right now
- Suggest one visual anchor for the deck (description only)
- Estimate completion time in minutes

Respond in this JSON schema:
{
  "learning_objective": "string",
  "estimated_minutes": number,
  "visual_anchor_description": "string",
  "cards": [
    {
      "type": "hook | content | apply",
      "front": "string",
      "back": "string"
    }
  ],
  "spaced_repetition_notes": "string describing which cards would benefit from resurfacing as a different artifact type later"
}`
}

// ─────────────────────────────────────────────────────────────────
// POST .../artifacts/generate
// ─────────────────────────────────────────────────────────────────
router.post('/generate', async (req, res) => {
  const { projectSlug, sourceSlug } = req.params
  const { artifactType } = req.body

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

  const ctxPath = path.join(sourceDir, 'context.json')
  const context = fs.existsSync(ctxPath)
    ? JSON.parse(fs.readFileSync(ctxPath, 'utf-8'))
    : {}

  const projectPath = path.join(PROJECTS_DIR, projectSlug, 'project.json')
  const project = fs.existsSync(projectPath)
    ? JSON.parse(fs.readFileSync(projectPath, 'utf-8'))
    : {}

  const userPrompt = buildFlipCardPrompt(sourceContent, context, project)

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

  const timestamp = Date.now()
  const folderName = `flip-cards-${timestamp}`
  const artifactDir = path.join(sourceDir, 'artifacts', folderName)
  fs.mkdirSync(artifactDir, { recursive: true })
  fs.writeFileSync(path.join(artifactDir, 'artifact.json'), JSON.stringify(artifact, null, 2))

  res.json({ folder: folderName, ...artifact })
})

module.exports = router
