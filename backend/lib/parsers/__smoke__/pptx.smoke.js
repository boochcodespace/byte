// Smoke test for parsers/pptx.js
//
// Builds a minimal PPTX in memory using adm-zip (the same lib the parser uses
// to unzip). No binary fixtures in the repo. The fixture has:
//   - Slide 1: title, body, embedded PNG, speaker notes
//   - Slide 2: hidden slide with title + body
//   - Slide 3: notes-only (no title or body)
//
// Run: node backend/lib/parsers/__smoke__/pptx.smoke.js

const assert = require('assert')
const AdmZip = require('adm-zip')
const { parsePptx } = require('../pptx')

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=',
  'base64'
)

// ─── XML templates ──────────────────────────────────────────────────────────
// These are the narrowest XML shapes our parser can read. A real PowerPoint-
// opened PPTX would have layouts, masters, themes, etc. — we skip all that
// since parsePptx doesn't read them.

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`

const PRESENTATION_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId10"/>
    <p:sldId id="257" r:id="rId11" show="0"/>
    <p:sldId id="258" r:id="rId12"/>
  </p:sldIdLst>
</p:presentation>`

const PRESENTATION_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId11" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
  <Relationship Id="rId12" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide3.xml"/>
</Relationships>`

// Slide 1: title + body + embedded image + speaker notes
function slide1Xml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Active Listening Principles</a:t></a:r></a:p></p:txBody>
    </p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>
      <p:txBody><a:bodyPr/><a:lstStyle/>
        <a:p><a:r><a:t>Full presence matters more than words.</a:t></a:r></a:p>
        <a:p><a:r><a:t>Paraphrase to confirm understanding.</a:t></a:r></a:p>
      </p:txBody>
    </p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="4" name="Picture"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>
    </p:sp>
    <p:pic><p:nvPicPr><p:cNvPr id="5" name="Diagram"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
      <p:blipFill><a:blip r:embed="rId20"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
      <p:spPr/>
    </p:pic>
  </p:spTree></p:cSld>
</p:sld>`
}

const SLIDE1_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId20" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
  <Relationship Id="rId21" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
</Relationships>`

const NOTES_SLIDE1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:spPr/>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Emphasise the HEAR framework here.</a:t></a:r></a:p></p:txBody>
    </p:sp>
  </p:spTree></p:cSld>
</p:notes>`

// Slide 2: hidden slide with title + body (no image, no notes)
const SLIDE2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr/>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Hidden Slide</a:t></a:r></a:p></p:txBody>
    </p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>This content shouldn't be shown in presentation mode.</a:t></a:r></a:p></p:txBody>
    </p:sp>
  </p:spTree></p:cSld>
</p:sld>`

const SLIDE2_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`

// Slide 3: notes-only (no title, no body on the slide itself)
const SLIDE3 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree></p:spTree></p:cSld>
</p:sld>`

const SLIDE3_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId30" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide3.xml"/>
</Relationships>`

const NOTES_SLIDE3 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:spPr/>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Notes-only slide — speaker walks through this verbally.</a:t></a:r></a:p></p:txBody>
    </p:sp>
  </p:spTree></p:cSld>
</p:notes>`

function buildPptx() {
  const zip = new AdmZip()
  zip.addFile('[Content_Types].xml', Buffer.from(CONTENT_TYPES))
  zip.addFile('_rels/.rels', Buffer.from(ROOT_RELS))
  zip.addFile('ppt/presentation.xml', Buffer.from(PRESENTATION_XML))
  zip.addFile('ppt/_rels/presentation.xml.rels', Buffer.from(PRESENTATION_RELS))
  zip.addFile('ppt/slides/slide1.xml', Buffer.from(slide1Xml()))
  zip.addFile('ppt/slides/_rels/slide1.xml.rels', Buffer.from(SLIDE1_RELS))
  zip.addFile('ppt/slides/slide2.xml', Buffer.from(SLIDE2))
  zip.addFile('ppt/slides/_rels/slide2.xml.rels', Buffer.from(SLIDE2_RELS))
  zip.addFile('ppt/slides/slide3.xml', Buffer.from(SLIDE3))
  zip.addFile('ppt/slides/_rels/slide3.xml.rels', Buffer.from(SLIDE3_RELS))
  zip.addFile('ppt/notesSlides/notesSlide1.xml', Buffer.from(NOTES_SLIDE1))
  zip.addFile('ppt/notesSlides/notesSlide3.xml', Buffer.from(NOTES_SLIDE3))
  zip.addFile('ppt/media/image1.png', TINY_PNG)
  return zip.toBuffer()
}

async function main() {
  console.log('[smoke:pptx] building minimal PPTX...')
  const buffer = buildPptx()
  console.log(`[smoke:pptx] built ${buffer.length} bytes`)

  console.log('[smoke:pptx] running parsePptx...')
  const result = await parsePptx(buffer, 'Fallback Title', 'smoke.pptx')

  // Slide 1 assertions
  assert.ok(result.markdown.includes('## Slide 1: Active Listening Principles'),
    'slide 1 header should include title, got:\n' + result.markdown)
  assert.ok(result.markdown.includes('Full presence matters more than words.'),
    'slide 1 body should be present')
  assert.ok(result.markdown.includes('Paraphrase to confirm understanding.'),
    'slide 1 second body line should be present')
  assert.ok(result.markdown.includes('Emphasise the HEAR framework here.'),
    'slide 1 speaker notes should be present')

  // Slide 2: hidden marker
  assert.ok(result.markdown.includes('## Slide 2: Hidden Slide'),
    'slide 2 header should include title')
  assert.ok(result.markdown.includes('[slide 2 is hidden in the source deck]'),
    'hidden marker should appear on slide 2')

  // Slide 3: notes-only
  assert.ok(result.markdown.includes('## Slide 3: (notes only)'),
    'slide 3 header should show notes-only label')
  assert.ok(result.markdown.includes('Notes-only slide — speaker walks through this verbally.'),
    'slide 3 notes should be present')

  // Image assertions
  assert.strictEqual(result.mediaFiles.length, 1, 'exactly 1 image should extract')
  assert.strictEqual(result.mediaFiles[0].filename, 'image-001.png')
  assert.strictEqual(result.mediaFiles[0].buffer.length, TINY_PNG.length)

  assert.strictEqual(result.manifest.images.length, 1)
  const entry = result.manifest.images[0]
  assert.strictEqual(entry.sourceType, 'pptx')
  assert.strictEqual(entry.sourcePosition, 'slide 1')
  assert.ok(entry.nearbyText.includes('Active Listening'),
    `nearbyText should reference slide 1 content, got "${entry.nearbyText}"`)
  assert.strictEqual(entry.width, 1)
  assert.strictEqual(entry.height, 1)
  assert.ok(entry.extractedAt.match(/^\d{4}-\d{2}-\d{2}T/))

  console.log('[smoke:pptx] PASS')
  console.log('  markdown length:', result.markdown.length)
  console.log('  images extracted:', result.manifest.images.length)
  console.log('  image 1:', JSON.stringify(entry, null, 2))
  console.log('\n--- source.md preview ---\n' + result.markdown)
}

main().catch(err => {
  console.error('[smoke:pptx] FAIL')
  console.error(err)
  process.exit(1)
})
