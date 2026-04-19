// routes/sources.js — CRUD for source documents in ~/Byte/sources/
// Each source lives in its own subfolder named by slug:
//   ~/Byte/sources/<slug>/source.md          — extracted/pasted text
//   ~/Byte/sources/<slug>/source-original.*  — original uploaded file (upload flow only)
//   ~/Byte/sources/<slug>/context.json       — learner context fields
//   ~/Byte/sources/<slug>/media/             — extracted images + manifest.json

const express = require('express')
const router = express.Router()
const fs = require('fs')
const path = require('path')
const os = require('os')
const slugify = require('slugify')
const multer = require('multer')

const SOURCES_DIR = path.join(os.homedir(), 'Byte', 'sources')

// ─── Multer configuration ────────────────────────────────────────────────────
// multer is the standard Express middleware for multipart/form-data — the
// encoding browsers use when sending files over HTTP.
//
// memoryStorage keeps the uploaded file as a Buffer in req.file.buffer.
// We write it to disk ourselves once we've built the target slug path,
// giving us full control over the destination filename.
const ALLOWED_EXTENSIONS = ['.pdf', '.pptx', '.docx', '.md', '.txt']
const MAX_FILE_BYTES = 25 * 1024 * 1024   // 25 MB

const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true)
    } else {
      // Passing an Error to cb rejects the upload before the route body runs
      cb(new Error(
        `"${ext}" files are not supported. Accepted: ${ALLOWED_EXTENSIONS.join(', ')}`
      ))
    }
  }
}).single('file')   // 'file' must match the FormData field name from the frontend

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureSourcesDir() {
  if (!fs.existsSync(SOURCES_DIR)) {
    fs.mkdirSync(SOURCES_DIR, { recursive: true })
  }
}

// Read context.json for a source; returns {} if missing
function readContext(sourceDir) {
  const ctxPath = path.join(sourceDir, 'context.json')
  if (!fs.existsSync(ctxPath)) return {}
  return JSON.parse(fs.readFileSync(ctxPath, 'utf-8'))
}

// Count artifact subfolders for a source
function countArtifacts(sourceDir) {
  const artifactsDir = path.join(sourceDir, 'artifacts')
  if (!fs.existsSync(artifactsDir)) return 0
  return fs.readdirSync(artifactsDir)
    .filter(f => fs.statSync(path.join(artifactsDir, f)).isDirectory())
    .length
}

// Extract title from source.md: first Markdown heading or first non-empty line
function extractTitle(content) {
  const firstLine = content.split('\n').find(l => l.trim()) || 'Untitled'
  return firstLine.replace(/^#+\s*/, '').trim()
}

// Build a unique slug; appends timestamp if the folder already exists
function makeSlug(title) {
  let slug = slugify(title.trim(), { lower: true, strict: true })
  if (!slug) slug = 'source'
  if (fs.existsSync(path.join(SOURCES_DIR, slug))) {
    slug = `${slug}-${Date.now()}`
  }
  return slug
}

// Build the standard source summary returned by list + create endpoints
function buildSourceSummary(slug, sourceDir) {
  const mdPath = path.join(sourceDir, 'source.md')
  const content = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf-8') : ''
  const title = extractTitle(content)
  const plainText = content.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').trim()
  const preview = plainText.slice(0, 150) + (plainText.length > 150 ? '...' : '')
  return { slug, title, preview, artifactCount: countArtifacts(sourceDir), context: readContext(sourceDir) }
}

// ─── Seeded example ──────────────────────────────────────────────────────────

function seedExampleIfEmpty() {
  ensureSourcesDir()
  if (fs.readdirSync(SOURCES_DIR).length > 0) return

  const slug = 'example-active-listening'
  const dir = path.join(SOURCES_DIR, slug)
  fs.mkdirSync(path.join(dir, 'media'), { recursive: true })

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
    role: 'Team Lead', experience: 'Intermediate', useCase: 'Improve team communication during 1:1s'
  }, null, 2))
  fs.writeFileSync(path.join(dir, 'media', 'manifest.json'), JSON.stringify({ images: [] }, null, 2))
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/sources — list all sources (summaries, no full content)
router.get('/', (req, res) => {
  ensureSourcesDir()
  seedExampleIfEmpty()

  const sources = fs.readdirSync(SOURCES_DIR)
    .filter(slug => fs.statSync(path.join(SOURCES_DIR, slug)).isDirectory())
    .map(slug => buildSourceSummary(slug, path.join(SOURCES_DIR, slug)))
    .reverse()

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
      .reverse()
  }

  res.json({
    slug: req.params.slug,
    title: extractTitle(content),
    content,
    context: readContext(sourceDir),
    artifacts
  })
})

// POST /api/sources — create a source from pasted text
router.post('/', (req, res) => {
  const { title, content } = req.body
  if (!title || !content) {
    return res.status(400).json({ error: 'title and content are required' })
  }

  ensureSourcesDir()
  const slug = makeSlug(title)
  const sourceDir = path.join(SOURCES_DIR, slug)

  // Create folder + media subfolder (consistent with upload-created sources)
  fs.mkdirSync(path.join(sourceDir, 'media'), { recursive: true })
  fs.writeFileSync(path.join(sourceDir, 'source.md'), content)
  fs.writeFileSync(path.join(sourceDir, 'context.json'), JSON.stringify(
    { role: '', experience: '', useCase: '' }, null, 2
  ))
  fs.writeFileSync(path.join(sourceDir, 'media', 'manifest.json'), JSON.stringify(
    { images: [] }, null, 2
  ))

  res.json(buildSourceSummary(slug, sourceDir))
})

// POST /api/sources/upload — accept a file upload (multipart/form-data)
//
// multipart/form-data is the HTTP encoding for file uploads. The browser
// sends the file as a binary stream alongside text fields. multer parses
// this and puts the file in req.file (buffer, originalname, size, mimetype)
// and text fields in req.body.
//
// This route only saves the raw file. Parsing (text + image extraction)
// is added incrementally in Steps 3–6 of Phase 2A.
router.post('/upload', (req, res) => {
  uploadMiddleware(req, res, async (err) => {
    // multer errors: LIMIT_FILE_SIZE (too large) or fileFilter rejection
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? `File exceeds the 25 MB limit.`
        : err.message
      return res.status(400).json({ error: message })
    }

    const { title } = req.body
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'title is required' })
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file was included in the upload.' })
    }

    const originalName = req.file.originalname
    const ext = path.extname(originalName).toLowerCase()

    try {
      ensureSourcesDir()
      const slug = makeSlug(title)
      const sourceDir = path.join(SOURCES_DIR, slug)

      // Create directory structure including media/ subfolder
      fs.mkdirSync(path.join(sourceDir, 'media'), { recursive: true })

      // ── Save the original file exactly as uploaded ──────────────────────
      // Naming convention: source-original.<ext>
      // This preserves the raw source material alongside the extracted text.
      fs.writeFileSync(path.join(sourceDir, `source-original${ext}`), req.file.buffer)

      // ── Write placeholder source.md ────────────────────────────────────
      // The # heading ensures extractTitle() returns the user-provided title.
      // Steps 3–6 will replace the placeholder body with real extracted content.
      const placeholder = [
        `# ${title.trim()}`,
        '',
        `[Source uploaded: ${originalName}]`,
        `[Parsing for ${ext} files will be added in an upcoming step.]`,
        `[Open this source to generate artifacts once parsing is available.]`,
      ].join('\n')
      fs.writeFileSync(path.join(sourceDir, 'source.md'), placeholder)

      // ── Write empty learner context and media manifest ──────────────────
      fs.writeFileSync(path.join(sourceDir, 'context.json'), JSON.stringify(
        { role: '', experience: '', useCase: '' }, null, 2
      ))
      fs.writeFileSync(path.join(sourceDir, 'media', 'manifest.json'), JSON.stringify(
        { images: [] }, null, 2
      ))

      console.log(`[upload] ${originalName} (${(req.file.size / 1024).toFixed(1)} KB) → ${slug}`)

      res.json(buildSourceSummary(slug, sourceDir))

    } catch (writeErr) {
      console.error('[upload] Failed to save source:', writeErr)
      res.status(500).json({ error: `Failed to save uploaded source: ${writeErr.message}` })
    }
  })
})

// PUT /api/sources/:slug — update content and/or context
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
