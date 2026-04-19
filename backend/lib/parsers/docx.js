// parsers/docx.js — DOCX (Word) file parser.
//
// Uses `mammoth` to convert DOCX to Markdown and stream embedded images out via
// its convertImage hook. Uses `image-size` to read pixel dimensions from the
// image bytes without saving the file first.
//
// Two-pass design:
//   1. mammoth converts text + inlines image references as ![filename](filename)
//      markers. We collect { filename, buffer, width, height } as each image
//      flows through the convertImage hook.
//   2. Walk the resulting markdown, find each image marker, and build manifest
//      entries with sourcePosition ("after paragraph N") and nearbyText.
//
// Graceful degradation: a single failing image is logged and skipped; mammoth
// warnings (SmartArt, charts, unsupported formatting) are logged once and
// parsing continues. A thrown error bubbles up to parseSourceFile, which
// writes a friendly marker into source.md instead of failing the upload.

const mammoth = require('mammoth')
const { imageSize } = require('image-size')

const IMAGE_EXT_BY_MIME = {
  'image/png':     '.png',
  'image/jpeg':    '.jpg',
  'image/jpg':     '.jpg',
  'image/gif':     '.gif',
  'image/bmp':     '.bmp',
  'image/svg+xml': '.svg',
  'image/tiff':    '.tiff',
  'image/webp':    '.webp',
  'image/x-emf':   '.emf',
  'image/x-wmf':   '.wmf',
}

function extFromMime(mime) {
  return IMAGE_EXT_BY_MIME[(mime || '').toLowerCase()] || '.bin'
}

function pad3(n) { return String(n).padStart(3, '0') }

// image-size throws on unsupported formats (e.g. WMF/EMF). Return nulls rather
// than failing so the image still makes it into the manifest.
function safeDimensions(buffer) {
  try {
    const result = imageSize(buffer)
    return { width: result.width || null, height: result.height || null }
  } catch {
    return { width: null, height: null }
  }
}

// Build a regex that matches a markdown image ref with this exact src.
function imageRefRegex(filename) {
  const esc = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('!\\[[^\\]]*\\]\\(' + esc + '\\)')
}

// "After paragraph N" = count of non-empty paragraphs (text blocks separated
// by blank lines) that appeared before this offset. Best-effort per spec.
function countParagraphsBefore(text) {
  if (!text.trim()) return 0
  return text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean).length
}

// Last ~200 chars of preceding text with image refs stripped and whitespace
// collapsed. Start at a word boundary where possible to avoid mid-word cuts.
function buildNearbyText(priorText, maxLen = 200) {
  const stripped = priorText
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (stripped.length <= maxLen) return stripped
  const slice = stripped.slice(-maxLen)
  const firstSpace = slice.indexOf(' ')
  return firstSpace > 0 && firstSpace < 20
    ? '…' + slice.slice(firstSpace + 1).trim()
    : '…' + slice.trim()
}

async function parseDocx(buffer, title, originalName) {
  // Collected in the order mammoth emits images, which matches document flow.
  const collected = []
  let seq = 0

  const convertImage = mammoth.images.imgElement(async (image) => {
    seq += 1
    const number = seq
    try {
      const imgBuffer = await image.read()
      const filename = `image-${pad3(number)}${extFromMime(image.contentType)}`
      const { width, height } = safeDimensions(imgBuffer)
      collected.push({ filename, buffer: imgBuffer, width, height })
      return { src: filename, alt: filename }
    } catch (err) {
      console.warn(`[docx] ${originalName}: skipped image #${number} — ${err.message}`)
      // Leave a harmless empty src so mammoth's markdown output stays valid.
      return { src: '', alt: 'image extraction failed' }
    }
  })

  const result = await mammoth.convertToMarkdown({ buffer }, { convertImage })

  // Log mammoth warnings once (unsupported constructs, unknown styles, etc).
  // These are not fatal — the surrounding text still extracted correctly.
  const warnings = (result.messages || []).filter(m => m.type === 'warning')
  if (warnings.length > 0) {
    console.warn(`[docx] ${originalName}: ${warnings.length} warning(s)`)
    for (const w of warnings.slice(0, 5)) console.warn(`  - ${w.message}`)
    if (warnings.length > 5) console.warn(`  ... and ${warnings.length - 5} more`)
  }

  // Ensure a heading — same rule as .md/.txt parsers.
  const markdownRaw = result.value || ''
  const hasHeading = /^\s*#\s+\S/.test(markdownRaw)
  const markdown = hasHeading ? markdownRaw : `# ${title.trim()}\n\n${markdownRaw}`

  const extractedAt = new Date().toISOString()
  const images = []
  const mediaFiles = []

  // Walk the markdown once, in order, consuming each image's first reference.
  // Images were collected in document order, so we keep a moving cursor.
  let cursor = 0
  for (const { filename, buffer: fileBuf, width, height } of collected) {
    const re = imageRefRegex(filename)
    const remaining = markdown.slice(cursor)
    const match = remaining.match(re)

    mediaFiles.push({ filename, buffer: fileBuf })

    if (!match) {
      // Image extracted but not referenced — still save it, note unknown pos.
      images.push({
        filename,
        sourceType: 'docx',
        sourcePosition: 'unknown',
        nearbyText: '',
        width, height,
        extractedAt,
      })
      continue
    }

    const absoluteIndex = cursor + match.index
    const priorText = markdown.slice(0, absoluteIndex)
    images.push({
      filename,
      sourceType: 'docx',
      sourcePosition: `after paragraph ${countParagraphsBefore(priorText)}`,
      nearbyText: buildNearbyText(priorText),
      width, height,
      extractedAt,
    })
    cursor = absoluteIndex + match[0].length
  }

  return { markdown, mediaFiles, manifest: { images } }
}

module.exports = { parseDocx }
