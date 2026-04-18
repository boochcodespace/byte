// routes/sources.js — CRUD for source documents in ~/Byte/sources/
// Each source lives in its own subfolder named by slug:
//   ~/Byte/sources/<slug>/source.md   — the raw source text
//   ~/Byte/sources/<slug>/context.json — learner context fields

const express = require('express')
const router = express.Router()
const fs = require('fs')
const path = require('path')
const os = require('os')
const slugify = require('slugify')   // converts "My Notes" → "my-notes"

const SOURCES_DIR = path.join(os.homedir(), 'Byte', 'sources')

function ensureSourcesDir() {
  if (!fs.existsSync(SOURCES_DIR)) {
    fs.mkdirSync(SOURCES_DIR, { recursive: true })
  }
}

// Read context.json for a source; returns empty object if missing
function readContext(sourceDir) {
  const ctxPath = path.join(sourceDir, 'context.json')
  if (!fs.existsSync(ctxPath)) return {}
  return JSON.parse(fs.readFileSync(ctxPath, 'utf-8'))
}

// Count how many artifact subfolders exist for a source
function countArtifacts(sourceDir) {
  const artifactsDir = path.join(sourceDir, 'artifacts')
  if (!fs.existsSync(artifactsDir)) return 0
  return fs.readdirSync(artifactsDir)
    .filter(f => fs.statSync(path.join(artifactsDir, f)).isDirectory())
    .length
}

// Extract the title from source.md: use the first Markdown heading or first line
function extractTitle(content) {
  const firstLine = content.split('\n').find(l => l.trim()) || 'Untitled'
  return firstLine.replace(/^#+\s*/, '').trim()
}

// On the very first run, seed one example source so there is
// something to click on before the user has added their own content.
function seedExampleIfEmpty() {
  ensureSourcesDir()
  const entries = fs.readdirSync(SOURCES_DIR)
  if (entries.length > 0) return   // already has sources

  const slug = 'example-active-listening'
  const dir = path.join(SOURCES_DIR, slug)
  fs.mkdirSync(dir, { recursive: true })

  const content = `# Active Listening in the Workplace

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

  fs.writeFileSync(path.join(dir, 'source.md'), content)
  fs.writeFileSync(path.join(dir, 'context.json'), JSON.stringify({
    role: 'Team Lead',
    experience: 'Intermediate',
    useCase: 'Improve team communication during 1:1s'
  }, null, 2))
}

// GET /api/sources — list all sources (summary, no full content)
router.get('/', (req, res) => {
  ensureSourcesDir()
  seedExampleIfEmpty()

  const sources = fs.readdirSync(SOURCES_DIR)
    .filter(slug => fs.statSync(path.join(SOURCES_DIR, slug)).isDirectory())
    .map(slug => {
      const sourceDir = path.join(SOURCES_DIR, slug)
      const mdPath = path.join(sourceDir, 'source.md')
      const content = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf-8') : ''
      const title = extractTitle(content)

      // Strip markdown symbols for a clean text preview
      const plainText = content.replace(/^#+\s*/gm, '').replace(/\*\*/g, '')
      const preview = plainText.slice(0, 150).trim() + (plainText.length > 150 ? '...' : '')

      return {
        slug,
        title,
        preview,
        artifactCount: countArtifacts(sourceDir),
        context: readContext(sourceDir)
      }
    })
    .reverse()   // newest folders last in readdir, so reverse gives newest first

  res.json(sources)
})

// GET /api/sources/:slug — full source with content and artifact list
router.get('/:slug', (req, res) => {
  const sourceDir = path.join(SOURCES_DIR, req.params.slug)
  if (!fs.existsSync(sourceDir)) {
    return res.status(404).json({ error: 'Source not found' })
  }

  const mdPath = path.join(sourceDir, 'source.md')
  const content = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf-8') : ''
  const title = extractTitle(content)
  const context = readContext(sourceDir)

  // Load artifact list: one entry per subfolder in /artifacts/
  const artifactsDir = path.join(sourceDir, 'artifacts')
  let artifacts = []
  if (fs.existsSync(artifactsDir)) {
    artifacts = fs.readdirSync(artifactsDir)
      .filter(f => fs.statSync(path.join(artifactsDir, f)).isDirectory())
      .map(folder => {
        const artifactFile = path.join(artifactsDir, folder, 'artifact.json')
        if (!fs.existsSync(artifactFile)) return null
        return { folder, ...JSON.parse(fs.readFileSync(artifactFile, 'utf-8')) }
      })
      .filter(Boolean)
      .reverse()   // newest first
  }

  res.json({ slug: req.params.slug, title, content, context, artifacts })
})

// POST /api/sources — create a new source
router.post('/', (req, res) => {
  const { title, content } = req.body
  if (!title || !content) {
    return res.status(400).json({ error: 'title and content are required' })
  }

  // slugify: "My First Source" → "my-first-source"
  let slug = slugify(title, { lower: true, strict: true })

  // Append timestamp if a folder with this slug already exists
  const sourceDir = path.join(SOURCES_DIR, slug)
  if (fs.existsSync(sourceDir)) {
    slug = `${slug}-${Date.now()}`
  }

  const finalDir = path.join(SOURCES_DIR, slug)
  fs.mkdirSync(finalDir, { recursive: true })
  fs.writeFileSync(path.join(finalDir, 'source.md'), content)
  fs.writeFileSync(path.join(finalDir, 'context.json'), JSON.stringify(
    { role: '', experience: '', useCase: '' }, null, 2
  ))

  const plainText = content.replace(/^#+\s*/gm, '').replace(/\*\*/g, '')
  res.json({
    slug,
    title,
    preview: plainText.slice(0, 150).trim() + (plainText.length > 150 ? '...' : ''),
    artifactCount: 0,
    context: { role: '', experience: '', useCase: '' }
  })
})

// PUT /api/sources/:slug — update content and/or context for a source
router.put('/:slug', (req, res) => {
  const sourceDir = path.join(SOURCES_DIR, req.params.slug)
  if (!fs.existsSync(sourceDir)) {
    return res.status(404).json({ error: 'Source not found' })
  }

  const { content, context } = req.body
  if (content !== undefined) {
    fs.writeFileSync(path.join(sourceDir, 'source.md'), content)
  }
  if (context !== undefined) {
    fs.writeFileSync(path.join(sourceDir, 'context.json'), JSON.stringify(context, null, 2))
  }

  res.json({ success: true })
})

module.exports = router
