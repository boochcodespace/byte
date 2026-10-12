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
//   knowledge-check-no-key   a knowledge check question with no key or several keys
//   missing-heading          a chunk with no real heading, or a lesson with no headings at all
//   heading-reads-like-text  a chunk title that is a whole paragraph
//   color-only-reference     "the green option", "the button on the left", "the round icon"
//   vague-link-text          "click here", "read more", ...
//   empty-link-text          a link with no text
//   reading-level            advisory: text above grade 8 (Flesch-Kincaid estimate)
//   acronym-not-spelled-out  advisory: an acronym not spelled out where it first appears
//   preview-skipped-*        blocks the learner preview leaves out
//
// An author can mark any issue as reviewed, with a reason. A review is tied
// to the exact text that triggered the issue, so editing that text brings
// the issue back.

const crypto = require('crypto')
const { needsKey } = require('../lib/artifact-edit')

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


// ── advisory checks (severity "note", never block an export) ──────────

// Flesch-Kincaid grade level, estimated from sentence length and syllables.
// It is a rough guide: short blocks are skipped because the estimate is
// unreliable on a few sentences.
const READING_GRADE_LIMIT = 8
const MIN_WORDS_FOR_GRADE = 25

function countSyllables(word) {
  let w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return 0
  if (w.length <= 3) return 1
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '')
  const groups = w.match(/[aeiouy]{1,2}/g)
  return Math.max(1, groups ? groups.length : 1)
}

function readingGrade(text) {
  const words = text.match(/[A-Za-z][A-Za-z'’-]*/g) || []
  if (words.length < MIN_WORDS_FOR_GRADE) return null
  const sentences = Math.max(1, (text.match(/[.!?]+(?:\s|$)/g) || []).length)
  const syllables = words.reduce((n, w) => n + countSyllables(w), 0)
  const grade = 0.39 * (words.length / sentences) + 11.8 * (syllables / words.length) - 15.59
  return Math.round(grade * 10) / 10
}

// Capital-letter words that are ordinary English or well-known marks and
// need no spelling out.
const NOT_ACRONYMS = new Set([
  'A', 'I', 'OK', 'AM', 'PM', 'TV', 'ID', 'US', 'USA', 'UK', 'EU', 'UN', 'PDF', 'URL', 'FAQ', 'FYI',
  'NOT', 'AND', 'THE', 'ALL', 'FOR', 'YOU', 'ARE', 'BUT', 'NEW', 'ONE', 'TWO', 'ANY', 'CAN', 'DO', 'IF',
  'IS', 'IT', 'NO', 'OF', 'ON', 'OR', 'SO', 'TO', 'UP', 'WE', 'AT', 'BE', 'BY', 'GO', 'HE', 'IN', 'ME',
  'MY', 'AS', 'AN', 'NOW', 'WHY', 'HOW', 'WHO', 'WAS', 'HAS', 'HAD', 'MAY', 'MUST', 'ONLY', 'ALSO',
  'NEVER', 'ALWAYS', 'WITH', 'THIS', 'THAT', 'FROM', 'YOUR', 'STOP', 'WAIT', 'NOTE', 'TIP', 'DAY',
])
const ACRONYM = /\b[A-Z]{2,6}s?\b/g

// Is `acr` spelled out where it appears at `index` in `text`?
//   "Domain Name System (DNS)"  or  "DNS (Domain Name System)"
function spelledOut(text, index, acr) {
  const before = text.slice(Math.max(0, index - 80), index)
  const after = text.slice(index + acr.length, index + acr.length + 80)
  if (/\(\s*$/.test(before) && /^\s*\)/.test(after)) {
    // "Words Words (ACR)": the words before the bracket should start with the letters
    const words = before.replace(/\(\s*$/, '').trim().split(/\s+/).slice(-acr.length - 2)
    const initials = words.map(w => (w[0] || '').toUpperCase()).join('')
    return initials.includes(acr[0]) || words.length >= 2
  }
  return /^\s*\(\s*[A-Za-z][^)]{3,}\)/.test(after)
}

function advisoryChecks(blocks, artifactFor, push) {
  const firstSeen = new Map()   // acronym -> true once handled
  for (const b of blocks) {
    const where = blockLabel(b)
    const items = learnerText(b, artifactFor(b))

    // Reading grade: one estimate per prose block, over its body text.
    if (['hook', 'chunk', 'apply', 'recall'].includes(b.kind) || (b.kind === 'tabs' && b.state !== 'proposed')) {
      const prose = b.kind === 'tabs'
        ? (b.tabs || []).map(t => t.body).join(' ')
        : [b.body, b.kind === 'recall' ? b.answer : ''].join(' ')
      const grade = readingGrade(prose)
      if (grade !== null && grade > READING_GRADE_LIMIT) {
        push({ rule: 'reading-level', severity: 'note', blockId: b.id, where, key: `reading-level:${b.id}:${fp(prose)}`,
          detail: `grade ${grade}`,
          message: `This text reads at about grade ${grade}. Aim for grade ${READING_GRADE_LIMIT} or lower: shorter sentences and everyday words. (This is a rough estimate.)` })
      }
    }

    // Acronyms: flag the first appearance in the lesson if it is not spelled out.
    for (const { where: spot, text } of items) {
      if (spot === 'alt text' || spot === 'long description') continue
      const letters = text.replace(/[^A-Za-z]/g, '')
      if (letters && letters === letters.toUpperCase() && letters.length > 3) continue   // an all-caps line
      ACRONYM.lastIndex = 0
      for (const m of text.matchAll(ACRONYM)) {
        const acr = m[0].replace(/s$/, '')
        if (NOT_ACRONYMS.has(acr) || firstSeen.has(acr)) continue
        firstSeen.set(acr, true)
        if (spelledOut(text, m.index, m[0])) continue
        push({ rule: 'acronym-not-spelled-out', severity: 'note', blockId: b.id, where,
          fix: b.kind === 'artifact' ? 'regenerate' : 'edit', detail: acr,
          key: `acronym-not-spelled-out:${b.id}:${acr}`,
          message: `The ${spot} uses "${acr}" without spelling it out. Write the full name the first time, for example "Domain Name System (DNS)".` })
      }
    }
  }
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

    // ── knowledge checks used in the lesson ─────────────────────────
    if (b.kind === 'artifact' && b.artifact_type === 'knowledge-check' && artifact) {
      for (const p of needsKey(artifact)) {
        push({ rule: 'knowledge-check-no-key', severity: 'warning', blockId: b.id, where, fix: 'edit',
          question: p.item, detail: `question ${p.item + 1}`,
          key: `knowledge-check-no-key:${b.id}:${p.item}:${b.ref.artifact}`,
          message: `Question ${p.item + 1} ${p.keys === 0 ? 'has no option marked as the key' : `has ${p.keys} options marked as the key`}, so learners get no clear strongest answer. Open the editor and mark exactly one.` })
      }
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

  advisoryChecks(blocks, b => (b.kind === 'artifact' && b.ref ? artifacts[`${b.ref.source}/${b.ref.artifact}`] || null : null), push)

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
