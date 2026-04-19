// Smoke test for parsers/docx.js
//
// Builds a minimal DOCX in memory (no binary fixtures in the repo), runs it
// through parseDocx, and asserts text and image extraction both work.
//
// A DOCX file is a ZIP archive containing OOXML. The minimum we need for
// mammoth to find text + one embedded image:
//   [Content_Types].xml            — declares MIME types inside the zip
//   _rels/.rels                    — root relationships, points at document.xml
//   word/document.xml              — the body with paragraphs + drawing ref
//   word/_rels/document.xml.rels   — relates rIds to media files
//   word/media/image1.png          — the actual embedded image bytes
//
// Run: node backend/lib/parsers/__smoke__/docx.smoke.js

const assert = require('assert')
const JSZip = require('jszip')
const { parseDocx } = require('../docx')

// 1x1 transparent PNG — 67 bytes. Base64 from the standard "smallest PNG".
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII='
const TINY_PNG = Buffer.from(TINY_PNG_BASE64, 'base64')

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`

// A drawing element referencing rId10. This is the minimum OOXML that mammoth
// recognises as an embedded image.
function drawingXml(relId) {
  return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Picture 1"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="img.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`
}

function paragraph(text) {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
}

function imageParagraph(relId) {
  return `<w:p><w:r>${drawingXml(relId)}</w:r></w:p>`
}

function heading(text) {
  return `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
}

async function buildDocx() {
  const body = [
    heading('Smoke Test Document'),
    paragraph('This is the first paragraph of the smoke test.'),
    paragraph('Here is some context text that will sit before the embedded image.'),
    imageParagraph('rId10'),
    paragraph('And here is text that follows the image.'),
  ].join('')

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`

  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES)
  zip.file('_rels/.rels', ROOT_RELS)
  zip.file('word/document.xml', document)
  zip.file('word/_rels/document.xml.rels', DOC_RELS)
  zip.file('word/media/image1.png', TINY_PNG)

  return zip.generateAsync({ type: 'nodebuffer' })
}

async function main() {
  console.log('[smoke:docx] building minimal docx...')
  const buffer = await buildDocx()
  console.log(`[smoke:docx] built ${buffer.length} bytes`)

  console.log('[smoke:docx] running parseDocx...')
  const result = await parseDocx(buffer, 'Fallback Title', 'smoke.docx')

  // Assertions
  assert.ok(result.markdown.includes('Smoke Test Document'),
    'markdown should include the heading text')
  assert.ok(result.markdown.includes('first paragraph of the smoke test'),
    'markdown should include first paragraph body')
  assert.ok(result.markdown.includes('text that follows the image'),
    'markdown should include post-image paragraph')

  assert.strictEqual(result.mediaFiles.length, 1, 'should extract exactly 1 image')
  const media = result.mediaFiles[0]
  assert.ok(media.filename.match(/^image-001\.(png|jpg|bin)$/),
    `filename should be image-001.<ext>, got ${media.filename}`)
  assert.ok(Buffer.isBuffer(media.buffer), 'media buffer should be a Buffer')
  assert.strictEqual(media.buffer.length, TINY_PNG.length,
    'extracted image bytes should match embedded image')

  assert.strictEqual(result.manifest.images.length, 1, 'manifest should have 1 image')
  const entry = result.manifest.images[0]
  assert.strictEqual(entry.sourceType, 'docx')
  assert.ok(entry.sourcePosition.startsWith('after paragraph '),
    `sourcePosition should start with "after paragraph ", got "${entry.sourcePosition}"`)
  assert.ok(entry.nearbyText.includes('context text'),
    `nearbyText should include surrounding text, got "${entry.nearbyText}"`)
  assert.strictEqual(entry.width, 1, 'width should match the 1x1 PNG')
  assert.strictEqual(entry.height, 1, 'height should match the 1x1 PNG')
  assert.ok(entry.extractedAt.match(/^\d{4}-\d{2}-\d{2}T/), 'extractedAt should be ISO timestamp')

  console.log('[smoke:docx] PASS')
  console.log('  markdown length:', result.markdown.length)
  console.log('  images extracted:', result.manifest.images.length)
  console.log('  image 1:', JSON.stringify(entry, null, 2))
}

main().catch(err => {
  console.error('[smoke:docx] FAIL')
  console.error(err)
  process.exit(1)
})
