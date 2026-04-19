// routes/sources.js — CRUD for sources within a project (project-scoped)
//
// Mounted as a nested router under projects:
//   /api/projects/:projectSlug/sources
//
// mergeParams: true inherits :projectSlug from the parent router.
// Artifacts are mounted as a further-nested router:
//   /api/projects/:projectSlug/sources/:sourceSlug/artifacts

const express = require('express')
const router = express.Router({ mergeParams: true })
const fs = require('fs')
const path = require('path')
const os = require('os')
const slugify = require('slugify')
const multer = require('multer')
const artifactsRouter = require('./artifacts')
const { parseDocx } = require('../lib/parsers/docx')
const { parsePdf, probePdf } = require('../lib/parsers/pdf')
const { UserFacingError } = require('../lib/parsers/errors')

const PROJECTS_DIR = path.join(os.homedir(), 'Byte', 'projects')
const ALLOWED_EXTENSIONS = ['.pdf', '.pptx', '.docx', '.md', '.txt']
const MAX_FILE_BYTES = 25 * 1024 * 1024

// ─── Multer ──────────────────────────────────────────────────────────────────
const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true)
    } else {
      cb(new Error(`"${ext}" files are not supported. Accepted: ${ALLOWED_EXTENSIONS.join(', ')}`))
    }
  }
}).single('file')

// Mount artifacts router — inherits :projectSlug + gains :sourceSlug
router.use('/:sourceSlug/artifacts', artifactsRouter)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSourceDir(projectSlug, sourceSlug) {
  return path.join(PROJECTS_DIR, projectSlug, 'sources', sourceSlug)
}

function extractTitle(content) {
  const firstLine = content.split('\n').find(l => l.trim()) || 'Untitled'
  return firstLine.replace(/^#+\s*/, '').trim()
}

function readContext(sourceDir) {
  const ctxPath = path.join(sourceDir, 'context.json')
  if (!fs.existsSync(ctxPath)) return {}
  return JSON.parse(fs.readFileSync(ctxPath, 'utf-8'))
}

function countArtifacts(sourceDir) {
  const artifactsDir = path.join(sourceDir, 'artifacts')
  if (!fs.existsSync(artifactsDir)) return 0
  return fs.readdirSync(artifactsDir)
    .filter(f => fs.statSync(path.join(artifactsDir, f)).isDirectory())
    .length
}

function makeSlug(title, sourcesDir) {
  let slug = slugify(title.trim(), { lower: true, strict: true })
  if (!slug) slug = 'source'
  if (fs.existsSync(path.join(sourcesDir, slug))) {
    slug = `${slug}-${Date.now()}`
  }
  return slug
}

// ─── Parsing ─────────────────────────────────────────────────────────────────
//
// parseSourceFile turns an uploaded buffer into the canonical shape we store:
//   - markdown:   the text that lands in source.md
//   - mediaFiles: [{ filename, buffer }] to drop into media/ (empty for now)
//   - manifest:   { images: [...] } that lands in media/manifest.json
//
// Step 3 handles .md and .txt (inline here). Steps 4–6 add binary-format
// parsers in lib/parsers/. The placeholderBranch fallback keeps unsupported
// extensions working the same way they did before parsing was added.
//
// TODO (future cleanup): for consistency, move parseMarkdown/parsePlainText
// out to lib/parsers/text.js alongside docx/pdf/pptx.

function stripBom(str) {
  return str.charCodeAt(0) === 0xFEFF ? str.slice(1) : str
}

function placeholderMarkdown(title, originalName, ext) {
  return [
    `# ${title.trim()}`,
    '',
    `[Source uploaded: ${originalName}]`,
    `[Parsing for ${ext} files will be added in an upcoming step.]`,
    `[Open this source to generate artifacts once parsing is available.]`,
  ].join('\n')
}

function parseMarkdown(buffer, title) {
  const text = stripBom(buffer.toString('utf-8'))
  // If the file already starts with a heading, trust it. Otherwise prepend
  // the user-entered title so extractTitle() and the UI have something real.
  const hasHeading = /^\s*#\s+\S/.test(text)
  return hasHeading ? text : `# ${title.trim()}\n\n${text}`
}

function parsePlainText(buffer, title) {
  const text = stripBom(buffer.toString('utf-8'))
  return `# ${title.trim()}\n\n${text}`
}

// preflightCheck: runs BEFORE any disk writes. Throws UserFacingError for
// known, user-addressable conditions (e.g. password-protected PDFs) so the
// route handler can return a friendly 400 with no side-effects. Most formats
// have a no-op preflight.
async function preflightCheck(buffer, ext) {
  if (ext === '.pdf') {
    await probePdf(buffer)
  }
}

async function parseSourceFile(buffer, ext, title, originalName) {
  const emptyManifest = { images: [] }
  try {
    switch (ext) {
      case '.md':
        return { markdown: parseMarkdown(buffer, title), mediaFiles: [], manifest: emptyManifest }
      case '.txt':
        return { markdown: parsePlainText(buffer, title), mediaFiles: [], manifest: emptyManifest }
      case '.docx':
        return await parseDocx(buffer, title, originalName)
      case '.pdf':
        return await parsePdf(buffer, title, originalName)
      default:
        // .pptx — real parser lands in Step 6.
        return {
          markdown: placeholderMarkdown(title, originalName, ext),
          mediaFiles: [],
          manifest: emptyManifest
        }
    }
  } catch (err) {
    // Parser blew up — never fail the upload. Write a clear marker so the
    // user sees what happened and can edit the source by hand if they want.
    console.error(`[parse] ${ext} parser failed for "${originalName}":`, err)
    return {
      markdown: [
        `# ${title.trim()}`,
        '',
        `[Could not parse ${originalName}: ${err.message}]`,
        `[The original file is preserved in this source's folder. You can`,
        ` paste content manually into this editor.]`,
      ].join('\n'),
      mediaFiles: [],
      manifest: emptyManifest
    }
  }
}

function buildSourceSummary(projectSlug, sourceSlug) {
  const sourceDir = getSourceDir(projectSlug, sourceSlug)
  const mdPath = path.join(sourceDir, 'source.md')
  const content = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf-8') : ''
  const title = extractTitle(content)
  const plainText = content.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').trim()
  const preview = plainText.slice(0, 150) + (plainText.length > 150 ? '...' : '')
  return {
    slug: sourceSlug,
    title,
    preview,
    artifactCount: countArtifacts(sourceDir),
    context: readContext(sourceDir)
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/projects/:projectSlug/sources
router.get('/', (req, res) => {
  const { projectSlug } = req.params
  const sourcesDir = path.join(PROJECTS_DIR, projectSlug, 'sources')
  if (!fs.existsSync(sourcesDir)) return res.json([])

  const sources = fs.readdirSync(sourcesDir)
    .filter(s => fs.statSync(path.join(sourcesDir, s)).isDirectory())
    .map(s => buildSourceSummary(projectSlug, s))
    .reverse()

  res.json(sources)
})

// GET /api/projects/:projectSlug/sources/:sourceSlug
router.get('/:sourceSlug', (req, res) => {
  const { projectSlug, sourceSlug } = req.params
  const sourceDir = getSourceDir(projectSlug, sourceSlug)
  if (!fs.existsSync(sourceDir)) return res.status(404).json({ error: 'Source not found' })

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
    slug: sourceSlug,
    title: extractTitle(content),
    content,
    context: readContext(sourceDir),
    artifacts
  })
})

// POST /api/projects/:projectSlug/sources — create from pasted text
router.post('/', (req, res) => {
  const { projectSlug } = req.params
  const { title, content } = req.body
  if (!title || !content) return res.status(400).json({ error: 'title and content are required' })

  const sourcesDir = path.join(PROJECTS_DIR, projectSlug, 'sources')
  fs.mkdirSync(sourcesDir, { recursive: true })
  const slug = makeSlug(title, sourcesDir)
  const sourceDir = path.join(sourcesDir, slug)

  fs.mkdirSync(path.join(sourceDir, 'media'), { recursive: true })
  fs.writeFileSync(path.join(sourceDir, 'source.md'), content)
  fs.writeFileSync(
    path.join(sourceDir, 'context.json'),
    JSON.stringify({ role: '', experience: '', useCase: '' }, null, 2)
  )
  fs.writeFileSync(
    path.join(sourceDir, 'media', 'manifest.json'),
    JSON.stringify({ images: [] }, null, 2)
  )

  res.json(buildSourceSummary(projectSlug, slug))
})

// POST /api/projects/:projectSlug/sources/upload — file upload (multipart/form-data)
router.post('/upload', (req, res) => {
  uploadMiddleware(req, res, async (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? 'File exceeds the 25 MB limit.'
        : err.message
      return res.status(400).json({ error: message })
    }

    const { projectSlug } = req.params
    const { title } = req.body
    if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' })
    if (!req.file) return res.status(400).json({ error: 'No file was included in the upload.' })

    const originalName = req.file.originalname
    const ext = path.extname(originalName).toLowerCase()

    // Preflight: reject known user-addressable conditions (e.g. password-
    // protected PDFs) BEFORE creating any files. Unknown preflight failures
    // are swallowed — the real parser's fallback will handle those.
    try {
      await preflightCheck(req.file.buffer, ext)
    } catch (preErr) {
      if (preErr instanceof UserFacingError) {
        return res.status(400).json({ error: preErr.message })
      }
      console.warn('[preflight] ignored:', preErr.message)
    }

    try {
      const sourcesDir = path.join(PROJECTS_DIR, projectSlug, 'sources')
      fs.mkdirSync(sourcesDir, { recursive: true })
      const slug = makeSlug(title, sourcesDir)
      const sourceDir = path.join(sourcesDir, slug)

      fs.mkdirSync(path.join(sourceDir, 'media'), { recursive: true })
      fs.writeFileSync(path.join(sourceDir, `source-original${ext}`), req.file.buffer)

      const { markdown, mediaFiles, manifest } = await parseSourceFile(
        req.file.buffer, ext, title, originalName
      )

      fs.writeFileSync(path.join(sourceDir, 'source.md'), markdown)
      fs.writeFileSync(
        path.join(sourceDir, 'context.json'),
        JSON.stringify({ role: '', experience: '', useCase: '' }, null, 2)
      )
      for (const { filename, buffer } of mediaFiles) {
        fs.writeFileSync(path.join(sourceDir, 'media', filename), buffer)
      }
      fs.writeFileSync(
        path.join(sourceDir, 'media', 'manifest.json'),
        JSON.stringify(manifest, null, 2)
      )

      console.log(`[upload] ${originalName} (${(req.file.size / 1024).toFixed(1)} KB) → ${projectSlug}/${slug}`)

      res.json(buildSourceSummary(projectSlug, slug))
    } catch (writeErr) {
      console.error('[upload] Failed to save source:', writeErr)
      res.status(500).json({ error: `Failed to save uploaded source: ${writeErr.message}` })
    }
  })
})

// PUT /api/projects/:projectSlug/sources/:sourceSlug — update content and/or context
router.put('/:sourceSlug', (req, res) => {
  const { projectSlug, sourceSlug } = req.params
  const sourceDir = getSourceDir(projectSlug, sourceSlug)
  if (!fs.existsSync(sourceDir)) return res.status(404).json({ error: 'Source not found' })

  const { content, context } = req.body
  if (content !== undefined) fs.writeFileSync(path.join(sourceDir, 'source.md'), content)
  if (context !== undefined) {
    fs.writeFileSync(path.join(sourceDir, 'context.json'), JSON.stringify(context, null, 2))
  }

  res.json({ success: true })
})

// DELETE /api/projects/:projectSlug/sources/:sourceSlug
router.delete('/:sourceSlug', (req, res) => {
  const { projectSlug, sourceSlug } = req.params
  const sourceDir = getSourceDir(projectSlug, sourceSlug)
  if (!fs.existsSync(sourceDir)) return res.status(404).json({ error: 'Source not found' })

  fs.rmSync(sourceDir, { recursive: true, force: true })
  res.json({ success: true })
})

module.exports = router
