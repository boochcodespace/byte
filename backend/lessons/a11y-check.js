// backend/lessons/a11y-check.js
//
// The lesson accessibility checker (ATAG 2.0 Part B: Byte helps authors
// produce accessible content). It looks at everything a learner will read
// or hear and lists what is wrong, in plain language, with the block to
// fix. It runs on demand, and exportBlockers() is what any future export
// must call first.
//
// Rules
//   missing-alt-text         a chunk or tab visual with no alt text and not marked decorative
//   decorative-no-reason     marked decorative without a reason
//   alt-text-long            alt text over 125 characters (a soft guide)
//   deck-missing-alt-text    a flip deck used in the lesson has a visual but no alt text
//   missing-heading          a chunk with no real heading, or a lesson with no headings at all
//   heading-reads-like-text  a chunk title that is a whole paragraph
//   color-only-reference     "the green option", "the button on the left", "the round icon"
//   vague-link-text          "click here", "read more", ...
//   empty-link-text          a link with no text
//   preview-skipped-*        blocks the learner preview leaves out
//
// An author can mark any issue as reviewed, with a reason. A review is tied
// to the exact text that triggered the issue, so editing that text brings
// the issue back.

const crypto = require('crypto')

const ALT_SOFT_LIMIT = 125

const fp = text => crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 8)

const COLORS = '(?:red|green|blue|yellow|orange|purple|pink|gray|grey|black|white|brown|teal)'
const THINGS = '(?:option|button|box|text|icon|line|circle|square|answer|arrow|area|section|card|one|bar|slice|dot|label|link|choice|item)'
const SIDES = '(?:left|right|top|bottom|upper|lower)'
const COLOR_ONLY = [
  new RegExp(`\\b(?:the\\s+)?${COLORS}\\s+${THINGS}\\b`, 'gi'),
  new RegExp(`\\b(?:marked|shown|highlighted|circled|written|printed)\\s+in\\s+${COLORS}\\b`, 'gi'),
  new RegExp(`\\b(?:the\\s+)?${SIDES}(?:-hand)?\\s+(?:option|button|box|column|side|corner|image|item|panel|card|icon)\\b`, 'gi'),
  new RegExp(`\\b(?:option|button|box|item|icon|answer|choice|card)\\s+(?:on|at|to)\\s+the\\s+${SIDES}\\b`, 'gi'),
  new RegExp('\\b(?:the\\s+)?(?:round|square|circular|triangular|rectangular|star-shaped)\\s+(?:button|icon|shape|box|option)\\b', 'gi'),
]
const VAGUE_LINK = /\b(?:click here|tap here|press here|read more|learn more|this link|see here)\b/gi
const EMPTY_LINK = /\[\s*\]\(/g
const VAGUE_MD_LINK = /\[\s*(?:here|link|click here|more|read more)\s*\]\(/gi

const PREVIEW_NAMES = {
  'flip-card-deck': 'flip card deck',
  'knowledge-check': 'knowledge check',
  'scenario-branching': 'scenario',
}

function blockLabel(b) {
  if (b.kind === 'chunk') return `chunk: ${b.title}`
  if (b.kind === 'hook') return 'hook'
  if (b.kind === 'apply') return 'apply block'
  if (b.kind === 'recall') return `day ${b.recall_day} recall prompt`
  if (b.kind === 'tabs') return b.title ? `tabs block: ${b.title}` : 'tabs block'
  return PREVIEW_NAMES[b.artifact_type] || 'artifact'
}

// Every string a learner reads or hears from one block, with a short name
// for where it sits.
function learnerText(b, artifact) {
  const out = []
  const add = (where, text) => { if (typeof text === 'string' && text.trim()) out.push({ where, text }) }
  if (b.kind === 'hook' || b.kind === 'apply') add('text', b.body)
  if (b.kind === 'chunk') {
    add('title', b.title); add('text', b.body)
    if (!b.decorative) { add('alt text', b.alt_text); add('long description', b.long_description) }
  }
  if (b.kind === 'recall') { add('question', b.body); add('answer', b.answer) }
  if (b.kind === 'tabs' && b.state !== 'proposed') {
    add('title', b.title)
    for (const t of b.tabs || []) {
      add(`tab "${t.label}" label`, t.label); add(`tab "${t.label}" text`, t.body)
      if (!t.decorative) { add(`tab "${t.label}" alt text`, t.alt_text); add(`tab "${t.label}" long description`, t.long_description) }
    }
  }
  if (b.kind === 'artifact' && artifact) {
    if (b.artifact_type === 'flip-card-deck') {
      (artifact.cards || []).forEach((c, i) => { add(`card ${i + 1} front`, c.front); add(`card ${i + 1} back`, c.back) })
    } else if (b.artifact_type === 'knowledge-check') {
      add('setup', artifact.setup); add('apply today', artifact.apply_today)
      ;(artifact.items || []).forEach((it, i) => {
        add(`question ${i + 1}`, it.scenario); add(`question ${i + 1}`, it.stem)
        ;(it.options || []).forEach(o => { add(`question ${i + 1} option`, o.text); add(`question ${i + 1} feedback`, o.rationale) })
      })
    } else if (b.artifact_type === 'scenario-branching') {
      add('setup', artifact.setup); add('apply today', artifact.apply_today)
      ;(artifact.nodes || []).forEach(n => {
        add('situation', n.situation)
        ;(n.choices || []).forEach(c => { add('choice', c.text); add('feedback', c.feedback) })
      })
    }
  }
  return out
}

function checkLesson(lesson, artifacts) {
  const issues = []
  const push = (issue) => issues.push({ category: 'content', severity: 'warning', fix: 'edit', ...issue })

  const blocks = lesson.blocks || []
  for (const b of blocks) {
    const where = blockLabel(b)
    const artifact = b.kind === 'artifact' && b.ref
      ? artifacts[`${b.ref.source}/${b.ref.artifact}`] || null
      : null

    // ── visuals: chunk and tabs ─────────────────────────────────────
    const visuals = []
    if (b.kind === 'chunk' && b.visual) visuals.push({ item: b, name: '', id: '' })
    if (b.kind === 'tabs' && b.state !== 'proposed') {
      for (const t of b.tabs || []) if (t.visual) visuals.push({ item: t, name: ` (tab "${t.label}")`, id: t.id })
    }
    for (const v of visuals) {
      const item = v.item
      const suffix = v.id ? `:${v.id}` : ''
      if (item.decorative) {
        if (!item.decorative_reason) {
          push({ rule: 'decorative-no-reason', severity: 'warning', blockId: b.id, where: where + v.name, key: `decorative-no-reason:${b.id}${suffix}:${fp(item.visual)}`,
            message: 'This visual is marked decorative, but no reason is given. Say why it adds no meaning, or write alt text instead.' })
        }
      } else if (!item.alt_text) {
        push({ rule: 'missing-alt-text', severity: 'error', blockId: b.id, where: where + v.name, key: `missing-alt-text:${b.id}${suffix}:${fp(item.visual)}`,
          message: 'This visual has no alt text, so learners will not see it and screen reader users get nothing. Add alt text, or mark it decorative with a reason.' })
      } else if (item.alt_text.length > ALT_SOFT_LIMIT) {
        push({ rule: 'alt-text-long', severity: 'note', blockId: b.id, where: where + v.name, key: `alt-text-long:${b.id}${suffix}:${fp(item.alt_text)}`,
          message: `The alt text is ${item.alt_text.length} characters. ${ALT_SOFT_LIMIT} or fewer reads best. Move the detail into the long description.` })
      }
    }

    // ── flip decks used in the lesson ───────────────────────────────
    if (b.kind === 'artifact' && b.artifact_type === 'flip-card-deck' && artifact
        && artifact.visual_anchor_description && !artifact.alt_text && !artifact.decorative) {
      push({ rule: 'deck-missing-alt-text', severity: 'warning', blockId: b.id, where, fix: 'regenerate',
        key: `deck-missing-alt-text:${b.id}:${b.ref.artifact}`,
        message: 'This flip card deck describes a visual but has no alt text. Regenerate it, or replace it with a newer deck, which includes alt text.' })
    }

    // ── headings ────────────────────────────────────────────────────
    if (b.kind === 'chunk') {
      const t = (b.title || '').trim()
      if (t.length < 2) {
        push({ rule: 'missing-heading', severity: 'error', blockId: b.id, where, key: `missing-heading:${b.id}`,
          message: 'This chunk has no title. A chunk title is a real heading that learners and screen readers use to find their way.' })
      } else if (t.length > 90 || /[.!?]\s+\S/.test(t)) {
        push({ rule: 'heading-reads-like-text', severity: 'warning', blockId: b.id, where, key: `heading-reads-like-text:${b.id}:${fp(t)}`,
          message: 'This title reads like a paragraph. Shorten it to the one idea the chunk teaches.' })
      }
    }

    // ── color, position, and shape references; links ────────────────
    const seen = new Set()
    for (const { where: spot, text } of learnerText(b, artifact)) {
      for (const re of COLOR_ONLY) {
        re.lastIndex = 0
        for (const m of text.matchAll(re)) {
          const phrase = m[0].trim().toLowerCase()
          if (seen.has(phrase)) continue
          seen.add(phrase)
          push({ rule: 'color-only-reference', severity: 'warning', blockId: b.id, where, detail: m[0].trim(), key: `color-only-reference:${b.id}:${fp(phrase)}`,
            fix: b.kind === 'artifact' ? 'regenerate' : 'edit',
            message: `The ${spot} says "${m[0].trim()}". Name things by their label or what they do, so it works without seeing color, position, or shape.` })
        }
      }
      VAGUE_LINK.lastIndex = 0
      for (const m of text.matchAll(VAGUE_LINK)) {
        const phrase = m[0].toLowerCase()
        if (seen.has('v:' + phrase)) continue
        seen.add('v:' + phrase)
        push({ rule: 'vague-link-text', severity: 'warning', blockId: b.id, where, detail: m[0], key: `vague-link-text:${b.id}:${fp(phrase)}`,
          fix: b.kind === 'artifact' ? 'regenerate' : 'edit',
          message: `The ${spot} says "${m[0]}". Link text should say where it goes or what it does.` })
      }
      VAGUE_MD_LINK.lastIndex = 0
      for (const m of text.matchAll(VAGUE_MD_LINK)) {
        push({ rule: 'vague-link-text', severity: 'warning', blockId: b.id, where, detail: m[0].replace(/[[\]()]/g, ''), key: `vague-link-text:${b.id}:${fp(m[0])}`,
          fix: b.kind === 'artifact' ? 'regenerate' : 'edit',
          message: `The ${spot} has a link that says "${m[0].replace(/[[\]()]/g, '')}". Link text should say where it goes or what it does.` })
      }
      EMPTY_LINK.lastIndex = 0
      if (EMPTY_LINK.test(text)) {
        push({ rule: 'empty-link-text', severity: 'error', blockId: b.id, where, key: `empty-link-text:${b.id}:${fp(text)}`,
          fix: b.kind === 'artifact' ? 'regenerate' : 'edit',
          message: `The ${spot} has a link with no text. A screen reader cannot say where it goes.` })
      }
    }

    // ── blocks the learner preview leaves out ───────────────────────
    if (b.kind === 'artifact' && b.state === 'proposed') {
      push({ rule: 'preview-skipped-proposal', category: 'preview', severity: 'note', blockId: b.id, where, fix: 'resolve',
        key: `preview-skipped-proposal:${b.id}`,
        message: `This suggested ${PREVIEW_NAMES[b.artifact_type] || 'artifact'} has nothing in it yet, so learners will not see it. Generate one, pick an existing one, or remove the suggestion.` })
    }
    if (b.kind === 'tabs' && b.state === 'proposed') {
      push({ rule: 'preview-skipped-proposal', category: 'preview', severity: 'note', blockId: b.id, where, fix: 'resolve',
        key: `preview-skipped-proposal:${b.id}`,
        message: 'This suggested tabs block has nothing in it yet, so learners will not see it. Generate it, write it yourself, or remove the suggestion.' })
    }
    if (b.kind === 'artifact' && b.state === 'ready' && (b.unavailable || !artifact)) {
      push({ rule: 'preview-skipped-missing-artifact', category: 'preview', severity: 'warning', blockId: b.id, where, fix: 'resolve',
        key: `preview-skipped-missing-artifact:${b.id}:${b.ref ? b.ref.artifact : ''}`,
        message: `The ${PREVIEW_NAMES[b.artifact_type] || 'artifact'} this block points to is no longer available, so learners will not see it. Pick another or generate a new one.` })
    }
    if ((b.kind === 'chunk' && b.visual && !b.decorative && !b.alt_text)) {
      push({ rule: 'preview-skipped-visual', category: 'preview', severity: 'note', blockId: b.id, where,
        key: `preview-skipped-visual:${b.id}:${fp(b.visual)}`,
        message: 'Learners will not see this chunk’s visual until it has alt text.' })
    }
  }

  // ── lesson level: headings ────────────────────────────────────────
  const hasHeading = blocks.some(b => (b.kind === 'chunk' && (b.title || '').trim().length >= 2)
    || (b.kind === 'tabs' && b.state !== 'proposed' && b.title))
  if (blocks.length && !hasHeading) {
    push({ rule: 'missing-heading', severity: 'warning', blockId: null, where: 'lesson', fix: 'none', key: 'missing-heading:lesson',
      message: 'This lesson has no headings. Add at least one chunk with a title so learners can scan and jump by heading.' })
  }

  return issues
}

// The report the API returns: every issue, whether it was reviewed and why,
// plus counts of what is still open. A review whose text changed no longer
// matches, so the issue shows up open again.
function buildReport(lesson, artifacts) {
  const reviews = new Map((lesson.a11y_reviews || []).map(r => [r.key, r]))
  const issues = checkLesson(lesson, artifacts).map(i => {
    const r = reviews.get(i.key)
    return { ...i, reviewed: !!r, review_reason: r ? r.reason : '' }
  })
  const open = issues.filter(i => !i.reviewed)
  return {
    issues,
    summary: {
      errors: open.filter(i => i.severity === 'error').length,
      warnings: open.filter(i => i.severity === 'warning').length,
      notes: open.filter(i => i.severity === 'note').length,
      reviewed: issues.length - open.length,
      open: open.length,
    },
  }
}

// What any future export (HTML, SCORM, ...) must check before it runs:
// open errors block it. Warnings and notes do not, but are reported.
function exportBlockers(lesson, artifacts) {
  return buildReport(lesson, artifacts).issues.filter(i => !i.reviewed && i.severity === 'error')
}

module.exports = { checkLesson, buildReport, exportBlockers, ALT_SOFT_LIMIT }
