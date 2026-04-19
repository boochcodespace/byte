// routes/projects.js — CRUD for projects + nested sources/artifacts mounts
//
// URL hierarchy:
//   /api/projects
//   /api/projects/:projectSlug
//   /api/projects/:projectSlug/sources          (→ sources router)
//   /api/projects/:projectSlug/sources/:sourceSlug/artifacts  (→ artifacts router)

const express = require('express')
const router = express.Router()
const fs = require('fs')
const path = require('path')
const os = require('os')
const slugify = require('slugify')
const crypto = require('crypto')
const sourcesRouter = require('./sources')

const PROJECTS_DIR = path.join(os.homedir(), 'Byte', 'projects')

// Mount sources nested router — passes :projectSlug down via mergeParams
router.use('/:projectSlug/sources', sourcesRouter)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureProjectsDir() {
  if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR, { recursive: true })
}

function readProject(projectSlug) {
  const projectPath = path.join(PROJECTS_DIR, projectSlug, 'project.json')
  if (!fs.existsSync(projectPath)) return null
  return JSON.parse(fs.readFileSync(projectPath, 'utf-8'))
}

function countSources(projectSlug) {
  const sourcesDir = path.join(PROJECTS_DIR, projectSlug, 'sources')
  if (!fs.existsSync(sourcesDir)) return 0
  return fs.readdirSync(sourcesDir)
    .filter(f => fs.statSync(path.join(sourcesDir, f)).isDirectory())
    .length
}

function countTotalArtifacts(projectSlug) {
  const sourcesDir = path.join(PROJECTS_DIR, projectSlug, 'sources')
  if (!fs.existsSync(sourcesDir)) return 0
  let total = 0
  for (const sourceSlug of fs.readdirSync(sourcesDir)) {
    const artifactsDir = path.join(sourcesDir, sourceSlug, 'artifacts')
    if (fs.existsSync(artifactsDir)) {
      total += fs.readdirSync(artifactsDir)
        .filter(f => fs.statSync(path.join(artifactsDir, f)).isDirectory())
        .length
    }
  }
  return total
}

function buildProjectSummary(projectSlug) {
  const project = readProject(projectSlug)
  if (!project) return null
  return {
    ...project,
    sourceCount: countSources(projectSlug),
    artifactCount: countTotalArtifacts(projectSlug)
  }
}

function makeProjectSlug(title) {
  let slug = slugify(title.trim(), { lower: true, strict: true })
  if (!slug) slug = 'project'
  if (fs.existsSync(path.join(PROJECTS_DIR, slug))) {
    slug = `${slug}-${Date.now()}`
  }
  return slug
}

// ─── Seeded example ──────────────────────────────────────────────────────────
// Runs only on fresh installs (projects dir empty). Gives new users something
// to click on immediately without any setup.

function seedExampleIfEmpty() {
  ensureProjectsDir()
  if (fs.readdirSync(PROJECTS_DIR).length > 0) return

  const projectSlug = 'getting-started'
  const projectDir = path.join(PROJECTS_DIR, projectSlug)
  const sourceSlug = 'active-listening'
  const sourceDir = path.join(projectDir, 'sources', sourceSlug)

  fs.mkdirSync(path.join(sourceDir, 'media'), { recursive: true })

  fs.writeFileSync(
    path.join(projectDir, 'project.json'),
    JSON.stringify({
      id: projectSlug,
      slug: projectSlug,
      title: 'Getting Started',
      description: 'Example project — explore Byte\'s features here.',
      styleGuide: '',
      targetAudience: 'Workplace professionals learning new skills',
      customInstructions: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, null, 2)
  )

  const sourceContent = `# Active Listening in the Workplace

Active listening is one of the most underrated professional skills. Most people listen to reply, not to understand.

## Key principles

**Full presence**: Put down your phone. Close distracting tabs. Make eye contact. Your body language signals whether you're truly engaged.

**Reflective listening**: After someone finishes, paraphrase what they said back to them. "What I'm hearing is..." This confirms you understood and makes the speaker feel heard.

**Ask clarifying questions**: Not yes/no questions. Open questions: "What did you mean by...?" or "Can you tell me more about...?"

**Resist the urge to fix**: When someone shares a problem, your first instinct may be to jump to solutions. Often people don't want a fix — they want to be understood. Ask: "Are you looking for advice, or do you want to talk through it?"

**Manage your internal monologue**: While someone is talking, most of us are composing our response. This is the enemy of listening. Practice letting your mind go blank and staying in their words.

## Why it matters at work

Studies show that managers who practise active listening have teams with 40% higher engagement scores. In sales, reps who listen more close 50% more deals.

## The HEAR framework

- **H**alt: Stop what you're doing
- **E**njoy the silence: Don't rush to fill pauses
- **A**sk: Probe for understanding
- **R**eflect: Mirror back what you heard

## Common failure modes

1. Interrupting before someone finishes their thought
2. Checking your phone during a conversation
3. Finishing other people's sentences
4. Immediately pivoting to your own similar story ("That reminds me of when I...")
5. Giving unsolicited advice

## A quick exercise

In your next one-on-one or meeting, set a goal: ask three clarifying questions before offering any opinion or advice. Notice how the quality of the conversation changes.`

  fs.writeFileSync(path.join(sourceDir, 'source.md'), sourceContent)
  fs.writeFileSync(
    path.join(sourceDir, 'context.json'),
    JSON.stringify({
      role: 'Team Lead',
      experience: 'Intermediate',
      useCase: 'Improve team communication during 1:1s'
    }, null, 2)
  )
  fs.writeFileSync(
    path.join(sourceDir, 'media', 'manifest.json'),
    JSON.stringify({ images: [] }, null, 2)
  )
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/projects — list all projects
router.get('/', (req, res) => {
  ensureProjectsDir()
  seedExampleIfEmpty()

  const projects = fs.readdirSync(PROJECTS_DIR)
    .filter(slug => fs.statSync(path.join(PROJECTS_DIR, slug)).isDirectory())
    .map(buildProjectSummary)
    .filter(Boolean)
    .reverse()

  res.json(projects)
})

// GET /api/projects/:projectSlug
router.get('/:projectSlug', (req, res) => {
  const { projectSlug } = req.params
  const project = readProject(projectSlug)
  if (!project) return res.status(404).json({ error: 'Project not found' })

  res.json({
    ...project,
    sourceCount: countSources(projectSlug),
    artifactCount: countTotalArtifacts(projectSlug)
  })
})

// POST /api/projects — create a new project
router.post('/', (req, res) => {
  const { title, description, styleGuide, targetAudience, customInstructions } = req.body
  if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' })

  ensureProjectsDir()
  const slug = makeProjectSlug(title)
  const projectDir = path.join(PROJECTS_DIR, slug)
  fs.mkdirSync(path.join(projectDir, 'sources'), { recursive: true })

  const project = {
    id: crypto.randomUUID(),
    slug,
    title: title.trim(),
    description: description || '',
    styleGuide: styleGuide || '',
    targetAudience: targetAudience || '',
    customInstructions: customInstructions || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(project, null, 2))

  res.json(buildProjectSummary(slug))
})

// PUT /api/projects/:projectSlug — update project fields
router.put('/:projectSlug', (req, res) => {
  const { projectSlug } = req.params
  const projectPath = path.join(PROJECTS_DIR, projectSlug, 'project.json')
  if (!fs.existsSync(projectPath)) return res.status(404).json({ error: 'Project not found' })

  const existing = JSON.parse(fs.readFileSync(projectPath, 'utf-8'))
  const { title, description, styleGuide, targetAudience, customInstructions } = req.body

  const updated = {
    ...existing,
    title: title !== undefined ? title : existing.title,
    description: description !== undefined ? description : existing.description,
    styleGuide: styleGuide !== undefined ? styleGuide : existing.styleGuide,
    targetAudience: targetAudience !== undefined ? targetAudience : existing.targetAudience,
    customInstructions: customInstructions !== undefined ? customInstructions : (existing.customInstructions || ''),
    updatedAt: new Date().toISOString()
  }
  fs.writeFileSync(projectPath, JSON.stringify(updated, null, 2))
  res.json({ success: true })
})

// DELETE /api/projects/:projectSlug — delete project and all its sources
router.delete('/:projectSlug', (req, res) => {
  const { projectSlug } = req.params
  const projectDir = path.join(PROJECTS_DIR, projectSlug)
  if (!fs.existsSync(projectDir)) return res.status(404).json({ error: 'Project not found' })

  fs.rmSync(projectDir, { recursive: true, force: true })
  res.json({ success: true })
})

module.exports = router
