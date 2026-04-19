// Smoke test for parsers/pdf.js
//
// Builds a tiny PDF in memory using pdf-lib (devDep, writing only), then runs
// it through parsePdf and asserts that text, page markers, and at least one
// image came through. No binary fixtures in the repo.
//
// Run: node backend/lib/parsers/__smoke__/pdf.smoke.js

const assert = require('assert')
const { parsePdf, probePdf } = require('../pdf')
const { UserFacingError } = require('../errors')

// 1x1 transparent PNG, 67 bytes — same as the docx smoke test.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=',
  'base64'
)

async function buildPdf() {
  const { PDFDocument } = require('pdf-lib')
  const doc = await PDFDocument.create()

  // Pages are wider than you'd think you need — default Helvetica glyph widths
  // push even short sentences off the right edge of a narrow page, and pdfjs
  // (correctly) returns only the visible glyphs. Overspec the page size.
  const page1 = doc.addPage([700, 400])
  page1.drawText('This is page one of the smoke test.', { x: 50, y: 350 })
  page1.drawText('Here is a second line on page one.', { x: 50, y: 320 })

  const page2 = doc.addPage([700, 400])
  page2.drawText('And this is page two of the smoke test.', { x: 50, y: 350 })
  page2.drawText('Preceding context for the image.', { x: 50, y: 320 })

  const embedded = await doc.embedPng(TINY_PNG)
  page2.drawImage(embedded, { x: 100, y: 100, width: 100, height: 100 })

  return Buffer.from(await doc.save())
}

async function main() {
  console.log('[smoke:pdf] building minimal PDF...')
  const buffer = await buildPdf()
  console.log(`[smoke:pdf] built ${buffer.length} bytes`)

  console.log('[smoke:pdf] probePdf on valid PDF...')
  await probePdf(buffer) // should NOT throw

  console.log('[smoke:pdf] probePdf on garbage bytes...')
  // A non-PDF buffer shouldn't throw UserFacingError — probePdf only flags
  // known conditions (password). Garbage is swallowed; the real parser
  // handles it via the fallback marker path.
  await probePdf(Buffer.from([0, 1, 2, 3, 4]))

  console.log('[smoke:pdf] running parsePdf...')
  const result = await parsePdf(buffer, 'Fallback Title', 'smoke.pdf')

  // Text assertions
  assert.ok(result.markdown.includes('[page 1]'), 'markdown should contain [page 1] marker')
  assert.ok(result.markdown.includes('[page 2]'), 'markdown should contain [page 2] marker')
  assert.ok(result.markdown.includes('page one of the smoke test'),
    'markdown should contain full page 1 text, got: ' + result.markdown.slice(0, 500))
  assert.ok(result.markdown.includes('page two of the smoke test'),
    'markdown should contain full page 2 text')
  assert.ok(result.markdown.includes('Preceding context for the image'),
    'markdown should contain page 2 image context line')
  assert.ok(!result.markdown.includes('appears to be scanned'),
    'should NOT trigger scanned-PDF fallback for this content')

  // Image assertions
  assert.strictEqual(result.mediaFiles.length, 1, 'should extract exactly 1 image')
  const media = result.mediaFiles[0]
  assert.strictEqual(media.filename, 'image-001.png')
  assert.ok(Buffer.isBuffer(media.buffer), 'media buffer should be a Buffer')
  // PNG magic number: 89 50 4E 47 0D 0A 1A 0A
  assert.strictEqual(media.buffer[0], 0x89, 'extracted image should be a valid PNG')
  assert.strictEqual(media.buffer[1], 0x50)
  assert.strictEqual(media.buffer[2], 0x4E)
  assert.strictEqual(media.buffer[3], 0x47)

  assert.strictEqual(result.manifest.images.length, 1)
  const entry = result.manifest.images[0]
  assert.strictEqual(entry.sourceType, 'pdf')
  assert.strictEqual(entry.sourcePosition, 'page 2')
  assert.ok(entry.nearbyText.includes('page two') || entry.nearbyText.includes('Preceding'),
    `nearbyText should reference page 2 content, got "${entry.nearbyText}"`)
  assert.strictEqual(entry.width, 1)
  assert.strictEqual(entry.height, 1)
  assert.ok(entry.extractedAt.match(/^\d{4}-\d{2}-\d{2}T/))

  console.log('[smoke:pdf] testing scanned-PDF fallback...')
  // A PDF with essentially no text should trip the scanned-PDF marker.
  const { PDFDocument } = require('pdf-lib')
  const emptyDoc = await PDFDocument.create()
  emptyDoc.addPage([400, 400])
  const emptyBuf = Buffer.from(await emptyDoc.save())
  const emptyResult = await parsePdf(emptyBuf, 'Empty', 'empty.pdf')
  assert.ok(emptyResult.markdown.includes('appears to be scanned'),
    'empty PDF should trigger scanned-PDF fallback: ' + emptyResult.markdown)

  console.log('[smoke:pdf] PASS')
  console.log('  markdown length:', result.markdown.length)
  console.log('  images extracted:', result.manifest.images.length)
  console.log('  image 1:', JSON.stringify(entry, null, 2))
}

main().catch(err => {
  console.error('[smoke:pdf] FAIL')
  console.error(err)
  process.exit(1)
})
