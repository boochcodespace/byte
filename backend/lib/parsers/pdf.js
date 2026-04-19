// parsers/pdf.js — PDF parser using pdfjs-dist (Mozilla's PDF.js engine).
//
// PDF text extraction is meaningfully harder than DOCX text extraction: PDFs
// are a presentation format, not a semantic one. Text is placed at absolute
// (x, y) coordinates with no notion of paragraphs, lists, or headings. We do
// the best we can: group text items by Y-coordinate to infer line breaks, and
// preserve page boundaries with [page N] markers so generation can cite them.
//
// Images come from the same library — pdfjs-dist decodes image XObjects into
// raw pixel buffers (RGB / RGBA / grayscale). We encode them to PNG using
// `pngjs` before saving. Vector graphics (paths, forms) are not extracted;
// they flow through operators we never inspect and are naturally skipped.
//
// Why not OCR scanned PDFs? Tesseract-in-Node is heavy, slow, and quality is
// highly variable. Out of scope for this phase. When total extracted chars
// across all pages is under 50, we write a clear marker so the user knows
// why their PDF didn't yield content.
//
// pdfjs-dist v5 is ESM-only. We consume it via a cached dynamic import so
// the rest of this CJS codebase doesn't need to change.

const { PNG } = require('pngjs')
const { UserFacingError } = require('./errors')

let pdfjsCache = null
async function getPdfjs() {
  if (!pdfjsCache) {
    // eslint-disable-next-line no-new-func — import() must not be transformed by CJS wrappers
    pdfjsCache = await import('pdfjs-dist/legacy/build/pdf.mjs')
  }
  return pdfjsCache
}

// ─── Public API ──────────────────────────────────────────────────────────────

// probePdf: quick "can this PDF be opened?" check run BEFORE any disk writes.
// Throws UserFacingError on known, user-addressable conditions (password).
// Unknown failures are swallowed — the real parser will write a friendly
// fallback marker later.
async function probePdf(buffer) {
  const pdfjs = await getPdfjs()
  let doc
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      verbosity: 0,
    }).promise
  } catch (err) {
    if (err?.name === 'PasswordException') {
      throw new UserFacingError(
        'This PDF is password-protected. Please remove the password protection and re-upload.'
      )
    }
    // Other failures: fall through; parsePdf will handle via its own fallback.
    return
  }
  try { await doc.destroy() } catch { /* ignore */ }
}

async function parsePdf(buffer, title, originalName) {
  const pdfjs = await getPdfjs()
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    verbosity: 0,
  }).promise

  const pageBlocks = []          // [{ page, text, failed }]
  const mediaFiles = []          // [{ filename, buffer }]
  const manifestImages = []
  const extractedAt = new Date().toISOString()
  let seq = 0
  let totalNonWhitespace = 0

  for (let p = 1; p <= doc.numPages; p++) {
    let page
    try {
      page = await doc.getPage(p)
    } catch (err) {
      console.warn(`[pdf] ${originalName}: page ${p} load failed — ${err.message}`)
      pageBlocks.push({ page: p, text: '', failed: true })
      continue
    }

    let pageText = ''
    try {
      pageText = await extractPageText(page)
      totalNonWhitespace += pageText.replace(/\s/g, '').length
      pageBlocks.push({ page: p, text: pageText, failed: false })
    } catch (err) {
      console.warn(`[pdf] ${originalName}: page ${p} text extraction failed — ${err.message}`)
      pageBlocks.push({ page: p, text: '', failed: true })
    }

    // Image extraction is best-effort and independent of text success.
    const nearbyText = buildNearbyFromPageText(pageText)
    try {
      for (const img of await extractPageImages(page, pdfjs, () => ++seq, originalName)) {
        mediaFiles.push({ filename: img.filename, buffer: img.buffer })
        manifestImages.push({
          filename: img.filename,
          sourceType: 'pdf',
          sourcePosition: `page ${p}`,
          nearbyText,
          width: img.width,
          height: img.height,
          extractedAt,
        })
      }
    } catch (err) {
      console.warn(`[pdf] ${originalName}: page ${p} image extraction failed — ${err.message}`)
    }
  }

  try { await doc.destroy() } catch { /* ignore */ }

  const markdown = buildMarkdown(title, pageBlocks, totalNonWhitespace)
  return { markdown, mediaFiles, manifest: { images: manifestImages } }
}

// ─── Text extraction ─────────────────────────────────────────────────────────

// pdfjs returns an array of text items with absolute positions. Items on the
// same line share a similar Y coordinate (item.transform[5]). When the Y jumps
// by more than LINE_THRESHOLD units from the previous item, we emit a newline.
// Not perfect — PDFs can have multi-column layouts where this mangles reading
// order — but good enough for the teaching material we expect.
const LINE_THRESHOLD = 2

async function extractPageText(page) {
  const tc = await page.getTextContent()
  if (!tc.items || tc.items.length === 0) return ''

  const lines = []
  let current = ''
  let lastY = null

  for (const item of tc.items) {
    if (typeof item.str !== 'string') continue
    const y = item.transform ? item.transform[5] : null
    if (lastY !== null && y !== null && Math.abs(y - lastY) > LINE_THRESHOLD) {
      if (current.trim()) lines.push(current.trim())
      current = ''
    }
    current += item.str
    // Items have an implicit space flag via hasEOL; add a space if the item
    // didn't end with one and the next likely continues the same logical word.
    if (!item.str.endsWith(' ') && !item.hasEOL) current += ' '
    lastY = y
  }
  if (current.trim()) lines.push(current.trim())

  // Collapse internal runs of spaces and trim trailing whitespace per line.
  return lines.map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
}

function buildNearbyFromPageText(pageText, maxLen = 200) {
  const flat = pageText.replace(/\s+/g, ' ').trim()
  return flat.length <= maxLen ? flat : flat.slice(0, maxLen) + '…'
}

// ─── Image extraction ────────────────────────────────────────────────────────
//
// pdfjs exposes images via the page's operator list. Every paintImageXObject
// operator references an image by name; we resolve the name through page.objs
// which returns a decoded { width, height, kind, data } record. We re-encode
// the decoded pixels as PNG via pngjs before saving.
//
// kind values (from pdfjs.ImageKind):
//   1 = GRAYSCALE_1BPP — packed monochrome bits
//   2 = RGB_24BPP       — 3 bytes per pixel, no alpha
//   3 = RGBA_32BPP      — 4 bytes per pixel

async function extractPageImages(page, pdfjs, nextSeq, originalName) {
  const results = []
  let ops
  try {
    ops = await page.getOperatorList()
  } catch (err) {
    console.warn(`[pdf] ${originalName}: could not read operator list — ${err.message}`)
    return results
  }

  const paintOp = pdfjs.OPS.paintImageXObject
  const seen = new Set()

  for (let i = 0; i < ops.fnArray.length; i++) {
    if (ops.fnArray[i] !== paintOp) continue
    const name = ops.argsArray[i][0]
    if (seen.has(name)) continue // avoid duplicate extraction of re-used images
    seen.add(name)

    let obj
    try {
      obj = await new Promise((resolve) => {
        try { page.objs.get(name, resolve) } catch (e) { resolve(null) }
      })
    } catch {
      obj = null
    }
    if (!obj) {
      console.warn(`[pdf] ${originalName}: image ${name} could not be resolved`)
      continue
    }

    const number = nextSeq()
    try {
      const png = encodeToPng(obj, pdfjs.ImageKind)
      if (!png) {
        console.warn(`[pdf] ${originalName}: image-${pad3(number)} skipped: unsupported pixel kind ${obj.kind}`)
        continue
      }
      results.push({
        filename: `image-${pad3(number)}.png`,
        buffer: png,
        width: obj.width,
        height: obj.height,
      })
    } catch (err) {
      console.warn(`[pdf] ${originalName}: image-${pad3(number)} skipped: ${err.message}`)
    }
  }

  return results
}

// Encode a pdfjs image object to a PNG buffer. Returns null if the kind is
// unsupported or the pixel data doesn't match the expected size.
function encodeToPng(obj, ImageKind) {
  const { width, height, kind, data } = obj
  if (!width || !height || !data) return null

  const rgba = Buffer.alloc(width * height * 4)

  if (kind === ImageKind.RGBA_32BPP) {
    if (data.length < width * height * 4) return null
    for (let i = 0; i < width * height * 4; i++) rgba[i] = data[i]
  } else if (kind === ImageKind.RGB_24BPP) {
    if (data.length < width * height * 3) return null
    for (let p = 0, s = 0, d = 0; p < width * height; p++, s += 3, d += 4) {
      rgba[d]     = data[s]
      rgba[d + 1] = data[s + 1]
      rgba[d + 2] = data[s + 2]
      rgba[d + 3] = 255
    }
  } else if (kind === ImageKind.GRAYSCALE_1BPP) {
    // Bits packed MSB-first, one row per ceil(width/8) bytes. Decode to
    // black/white RGBA so the image is a legible export.
    const rowBytes = Math.ceil(width / 8)
    if (data.length < rowBytes * height) return null
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = data[y * rowBytes + (x >> 3)]
        const bit = (byte >> (7 - (x & 7))) & 1
        const v = bit ? 255 : 0
        const d = (y * width + x) * 4
        rgba[d] = v; rgba[d + 1] = v; rgba[d + 2] = v; rgba[d + 3] = 255
      }
    }
  } else {
    return null
  }

  const png = new PNG({ width, height })
  rgba.copy(png.data)
  return PNG.sync.write(png)
}

function pad3(n) { return String(n).padStart(3, '0') }

// ─── Markdown assembly ───────────────────────────────────────────────────────

function buildMarkdown(title, pageBlocks, totalNonWhitespace) {
  const heading = `# ${title.trim()}`
  if (totalNonWhitespace < 50) {
    // Scanned PDF, or every page failed — consistent user-facing fallback.
    return [
      heading,
      '',
      '[This PDF appears to be scanned. OCR is not supported in this phase. Consider uploading a text-based version for best results.]',
      '',
    ].join('\n')
  }

  const parts = [heading, '']
  for (const { page, text, failed } of pageBlocks) {
    parts.push(`[page ${page}]`)
    parts.push(failed ? `[page ${page}: text extraction failed]` : text)
    parts.push('')
  }
  return parts.join('\n')
}

module.exports = { parsePdf, probePdf }
