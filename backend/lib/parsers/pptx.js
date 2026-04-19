// parsers/pptx.js — PPTX (PowerPoint) file parser.
//
// A .pptx is a ZIP archive containing XML + media. The structure we care about:
//
//   ppt/slides/slide1.xml              — slide 1's content (title + body)
//   ppt/slides/_rels/slide1.xml.rels   — image references for slide 1
//   ppt/slides/slide2.xml              — slide 2's content
//   ppt/slides/_rels/slide2.xml.rels   — ...
//   ppt/notesSlides/notesSlide1.xml    — speaker notes for slide 1 (optional)
//   ppt/media/image1.png               — the actual image bytes
//   ppt/presentation.xml               — slide ordering + hidden-slide attrs
//
// We deliberately do NOT read slide layouts or slide masters — those contain
// template text (page numbers, footers, placeholders) that isn't authored
// content. The spec is explicit: only extract text that appears on actual
// slides.
//
// Graceful degradation: every slide is wrapped in its own try/catch. A single
// failing slide logs and becomes "[slide N: extraction failed]" in source.md
// — other slides continue. A corrupt archive throws up to parseSourceFile,
// which writes the "could not parse" marker.

const AdmZip = require('adm-zip')
const xml2js = require('xml2js')
const path = require('path')
const { imageSize } = require('image-size')

// ─── Public API ──────────────────────────────────────────────────────────────

async function parsePptx(buffer, title, originalName) {
  const zip = new AdmZip(buffer)
  const entries = zip.getEntries()
  const entryMap = new Map(entries.map(e => [e.entryName, e]))

  // Figure out slide ordering + hidden flags from presentation.xml.
  // presentation.xml lists sldIds in their display order, each with an rId
  // that points via presentation.xml.rels to the actual slide file.
  const slideOrder = await readSlideOrder(entryMap)

  const slideBlocks = []
  const mediaFiles = []
  const manifestImages = []
  const extractedAt = new Date().toISOString()
  let imageSeq = 0
  // Track already-exported media files so an image shared across slides
  // lands in media/ only once but gets a manifest entry per slide.
  const exportedByInternal = new Map()

  for (let idx = 0; idx < slideOrder.length; idx++) {
    const { slideFile, hidden, slideNumber } = slideOrder[idx]
    try {
      const slideEntry = entryMap.get(slideFile)
      if (!slideEntry) {
        slideBlocks.push(failedBlock(slideNumber, 'slide file missing from archive'))
        continue
      }

      const slideXml = slideEntry.getData().toString('utf-8')
      const slideDoc = await xml2js.parseStringPromise(slideXml, { explicitArray: false })

      const { titleText, bodyText } = extractSlideText(slideDoc)
      const notesText = await readNotesForSlide(entryMap, slideFile)

      // Image refs are resolved via the slide's own .rels file.
      const relsFile = slideRelsPath(slideFile)
      const relsMap = await readRelsMap(entryMap, relsFile)

      // Collect blip references from the slide doc (these live on <a:blip r:embed="rIdX"/>).
      const blipRefs = collectBlipEmbedIds(slideDoc)

      const slideImages = []
      for (const rId of blipRefs) {
        const rel = relsMap.get(rId)
        if (!rel) continue
        const internalPath = resolveRelPath(slideFile, rel.target)
        const mediaEntry = entryMap.get(internalPath)
        if (!mediaEntry) {
          console.warn(`[pptx] ${originalName}: slide ${slideNumber} image "${internalPath}" missing from archive`)
          continue
        }

        let filename
        if (exportedByInternal.has(internalPath)) {
          filename = exportedByInternal.get(internalPath)
        } else {
          imageSeq += 1
          const ext = (path.extname(internalPath) || '.bin').toLowerCase()
          filename = `image-${pad3(imageSeq)}${ext}`
          exportedByInternal.set(internalPath, filename)
          mediaFiles.push({ filename, buffer: mediaEntry.getData() })
        }

        const { width, height } = safeDimensions(mediaEntry.getData())
        slideImages.push({ filename, width, height })
      }

      slideBlocks.push({
        slideNumber,
        hidden,
        titleText,
        bodyText,
        notesText,
        failed: false,
      })

      // Build manifest entries for this slide now that we know the text.
      const nearby = buildNearbyText(titleText, bodyText)
      for (const { filename, width, height } of slideImages) {
        manifestImages.push({
          filename,
          sourceType: 'pptx',
          sourcePosition: `slide ${slideNumber}`,
          nearbyText: nearby,
          width,
          height,
          extractedAt,
        })
      }
    } catch (err) {
      console.warn(`[pptx] ${originalName}: slide ${slideNumber} failed — ${err.message}`)
      slideBlocks.push(failedBlock(slideNumber, err.message))
    }
  }

  const markdown = buildMarkdown(title, slideBlocks)
  return { markdown, mediaFiles, manifest: { images: manifestImages } }
}

// ─── Slide ordering / hidden detection ───────────────────────────────────────

async function readSlideOrder(entryMap) {
  // Default fallback: find slide*.xml files and sort numerically.
  const fallback = () => {
    const found = []
    for (const name of entryMap.keys()) {
      const m = name.match(/^ppt\/slides\/slide(\d+)\.xml$/)
      if (m) found.push({ slideFile: name, number: parseInt(m[1], 10) })
    }
    found.sort((a, b) => a.number - b.number)
    return found.map((f, i) => ({
      slideFile: f.slideFile,
      hidden: false,
      slideNumber: i + 1,
    }))
  }

  const presEntry = entryMap.get('ppt/presentation.xml')
  const relsEntry = entryMap.get('ppt/_rels/presentation.xml.rels')
  if (!presEntry || !relsEntry) return fallback()

  try {
    const presDoc = await xml2js.parseStringPromise(presEntry.getData().toString('utf-8'), {
      explicitArray: false,
    })
    const relsDoc = await xml2js.parseStringPromise(relsEntry.getData().toString('utf-8'), {
      explicitArray: false,
    })

    // Build rId → target lookup from presentation.xml.rels
    const rels = asArray(relsDoc?.Relationships?.Relationship)
    const relById = new Map()
    for (const r of rels) {
      relById.set(r.$.Id, r.$.Target) // e.g. "slides/slide1.xml"
    }

    // Walk <p:sldIdLst><p:sldId r:id="rId2" show="0"?/> in order.
    const sldIds = asArray(presDoc?.['p:presentation']?.['p:sldIdLst']?.['p:sldId'])
    const result = []
    let n = 0
    for (const s of sldIds) {
      const rId = s.$?.['r:id']
      const target = relById.get(rId)
      if (!target) continue
      const internalPath = resolveRelPath('ppt/presentation.xml', target)
      // `show="0"` (or "false") means the slide is hidden in the deck.
      const showAttr = s.$?.show
      const hidden = showAttr === '0' || showAttr === 'false'
      n += 1
      result.push({ slideFile: internalPath, hidden, slideNumber: n })
    }
    return result.length > 0 ? result : fallback()
  } catch {
    return fallback()
  }
}

// ─── Slide text extraction ───────────────────────────────────────────────────

// The title is typically a shape whose <p:nvSpPr><p:nvPr><p:ph type="..."/>
// has type "ctrTitle" or "title". Everything else is body text. We walk shapes
// and classify each one.
function extractSlideText(slideDoc) {
  const spTree = slideDoc?.['p:sld']?.['p:cSld']?.['p:spTree']
  if (!spTree) return { titleText: '', bodyText: '' }

  const shapes = asArray(spTree['p:sp'])
  let titleText = ''
  const bodyParts = []

  for (const sp of shapes) {
    const phType = sp?.['p:nvSpPr']?.['p:nvPr']?.['p:ph']?.$?.type
    const text = readShapeText(sp)
    if (!text) continue
    if (phType === 'ctrTitle' || phType === 'title') {
      // First title wins if multiple shapes declare themselves title.
      if (!titleText) titleText = text
    } else {
      bodyParts.push(text)
    }
  }

  return {
    titleText: titleText.trim(),
    bodyText: bodyParts.join('\n').trim(),
  }
}

// Pull text from a shape. PPTX text is: <p:txBody> > <a:p> (paragraphs) >
// <a:r> (runs) > <a:t> (text). We preserve paragraph breaks as newlines.
function readShapeText(sp) {
  const paragraphs = asArray(sp?.['p:txBody']?.['a:p'])
  const lines = []
  for (const p of paragraphs) {
    const runs = asArray(p?.['a:r'])
    const parts = runs.map(r => (typeof r?.['a:t'] === 'string' ? r['a:t'] : '')).filter(Boolean)
    // Also handle break elements <a:br/> — treat as intra-paragraph line breaks.
    const line = parts.join('')
    if (line) lines.push(line)
    else if (p?.['a:br'] !== undefined) lines.push('')
  }
  return lines.join('\n')
}

async function readNotesForSlide(entryMap, slideFile) {
  // Slide n's notes live in ppt/notesSlides/notesSlideN.xml. Resolve the
  // relationship properly rather than guessing the number from the filename.
  const slideRels = slideRelsPath(slideFile)
  const relsMap = await readRelsMap(entryMap, slideRels)
  let notesInternal = null
  for (const rel of relsMap.values()) {
    if (rel.type.endsWith('/notesSlide')) {
      notesInternal = resolveRelPath(slideFile, rel.target)
      break
    }
  }
  if (!notesInternal) return ''
  const notesEntry = entryMap.get(notesInternal)
  if (!notesEntry) return ''

  try {
    const doc = await xml2js.parseStringPromise(notesEntry.getData().toString('utf-8'), {
      explicitArray: false,
    })
    const spTree = doc?.['p:notes']?.['p:cSld']?.['p:spTree']
    const shapes = asArray(spTree?.['p:sp'])
    const lines = []
    for (const sp of shapes) {
      // The notes placeholder has type "body" — the "slideImage" placeholder
      // (a rendered thumbnail) has type "sldImg" and no real text. We just
      // collect text from every shape; empty shapes contribute nothing.
      const text = readShapeText(sp)
      if (text.trim()) lines.push(text.trim())
    }
    return lines.join('\n').trim()
  } catch {
    return ''
  }
}

// ─── Relationships + image discovery ─────────────────────────────────────────

async function readRelsMap(entryMap, relsPath) {
  const entry = entryMap.get(relsPath)
  if (!entry) return new Map()
  try {
    const doc = await xml2js.parseStringPromise(entry.getData().toString('utf-8'), {
      explicitArray: false,
    })
    const rels = asArray(doc?.Relationships?.Relationship)
    const map = new Map()
    for (const r of rels) {
      map.set(r.$.Id, { target: r.$.Target, type: r.$.Type })
    }
    return map
  } catch {
    return new Map()
  }
}

// Recursively walk the parsed slide doc and collect every r:embed attribute
// that appears on <a:blip>. These are the relationship IDs of embedded images.
function collectBlipEmbedIds(node, acc = []) {
  if (!node || typeof node !== 'object') return acc
  if (Array.isArray(node)) {
    for (const item of node) collectBlipEmbedIds(item, acc)
    return acc
  }
  for (const key of Object.keys(node)) {
    if (key === 'a:blip') {
      for (const blip of asArray(node[key])) {
        const rId = blip?.$?.['r:embed']
        if (rId) acc.push(rId)
      }
    } else {
      collectBlipEmbedIds(node[key], acc)
    }
  }
  return acc
}

function slideRelsPath(slideFile) {
  // ppt/slides/slide1.xml → ppt/slides/_rels/slide1.xml.rels
  const dir = path.posix.dirname(slideFile)
  const base = path.posix.basename(slideFile)
  return `${dir}/_rels/${base}.rels`
}

// Relationship targets are relative to the referring file's directory. For
// "../media/image1.png" from ppt/slides/slide1.xml → ppt/media/image1.png.
function resolveRelPath(fromFile, target) {
  const fromDir = path.posix.dirname(fromFile)
  // normalize to forward slashes since the zip uses them regardless of OS.
  const resolved = path.posix.normalize(path.posix.join(fromDir, target))
  // path.posix.normalize may keep ".." for paths that escape root — PPTX
  // targets should stay inside the archive; if not, the entryMap lookup will
  // fail and we skip it.
  return resolved
}

// ─── Markdown assembly ───────────────────────────────────────────────────────

function buildMarkdown(title, slideBlocks) {
  const parts = [`# ${title.trim()}`, '']
  for (const block of slideBlocks) {
    const { slideNumber, hidden, titleText, bodyText, notesText, failed, error } = block

    if (failed) {
      parts.push(`## Slide ${slideNumber}: [extraction failed]`)
      parts.push(`[slide ${slideNumber} extraction failed: ${error}]`)
      parts.push('')
      continue
    }

    // Slide title line
    let headerLabel
    if (titleText) headerLabel = titleText
    else if (bodyText) headerLabel = '(no title)'
    else if (notesText) headerLabel = '(notes only)'
    else headerLabel = '(no title)'

    parts.push(`## Slide ${slideNumber}: ${headerLabel}`)
    if (hidden) parts.push(`[slide ${slideNumber} is hidden in the source deck]`)
    parts.push('')

    if (bodyText) {
      parts.push(bodyText)
      parts.push('')
    }

    parts.push('### Speaker Notes')
    parts.push(notesText || '(none)')
    parts.push('')
  }
  return parts.join('\n')
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function asArray(x) {
  if (x === undefined || x === null) return []
  return Array.isArray(x) ? x : [x]
}

function pad3(n) { return String(n).padStart(3, '0') }

function safeDimensions(buffer) {
  try {
    const r = imageSize(buffer)
    return { width: r.width || null, height: r.height || null }
  } catch {
    return { width: null, height: null }
  }
}

function buildNearbyText(titleText, bodyText, maxLen = 200) {
  const pieces = []
  if (titleText) pieces.push(titleText)
  if (bodyText) pieces.push(bodyText)
  const flat = pieces.join(' — ').replace(/\s+/g, ' ').trim()
  return flat.length <= maxLen ? flat : flat.slice(0, maxLen) + '…'
}

function failedBlock(slideNumber, error) {
  return { slideNumber, hidden: false, titleText: '', bodyText: '', notesText: '', failed: true, error }
}

module.exports = { parsePptx }
