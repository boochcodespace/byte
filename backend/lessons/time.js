// backend/lessons/time.js
//
// The lesson time model. Time is COMPUTED here, never taken from the
// model's own estimated_minutes, so the meter is consistent and an edited
// artifact changes the total.
//
// Rules (approved as a starting point):
//   - text is read at 200 words per minute
//   - every interaction (a card, a question, a decision) adds 30 seconds
//   - recall prompts are done on day 2, 7 and 21, so they are shown but
//     NOT counted in the lesson total
//   - a tabs block counts every word in its title, tab labels and tab
//     bodies at 200 words per minute, plus 15 seconds per tab for
//     switching between them
//
// A proposed artifact has no content yet, so it uses a default estimate
// based on the in-lesson sizes (4 cards, 3 items, 2 decisions). Once the
// artifact exists, its time comes from its actual content.

const { artifactKey } = require('./store')

const WORDS_PER_MINUTE = 200
const INTERACTION_MINUTES = 0.5

const DEFAULT_ARTIFACT_MINUTES = {
  'flip-card-deck': 2.7,
  'knowledge-check': 2.9,
  'scenario-branching': 2.7,
}
const FALLBACK_ARTIFACT_MINUTES = 2.5

// Tabs: 15 seconds per tab to switch. A proposed tabs block has no content
// yet, so it uses a default for about three short tabs.
const TAB_SWITCH_MINUTES = 0.25
const DEFAULT_TABS_MINUTES = 1.4

const words = (...parts) =>
  parts.filter(p => typeof p === 'string').join(' ').trim().split(/\s+/).filter(Boolean).length
const readMinutes = wordCount => wordCount / WORDS_PER_MINUTE
const round1 = n => Math.round(n * 10) / 10
const arr = v => (Array.isArray(v) ? v : [])

function flipDeckMinutes(a) {
  return arr(a.cards).reduce(
    (sum, c) => sum + readMinutes(words(c.front, c.back)) + INTERACTION_MINUTES, 0)
}

function knowledgeCheckMinutes(a) {
  let total = readMinutes(words(a.setup))
  for (const item of arr(a.items)) {
    const options = arr(item.options)
    const rationaleWords = options.map(o => words(o.rationale))
    const avgRationale = rationaleWords.length
      ? rationaleWords.reduce((x, y) => x + y, 0) / rationaleWords.length : 0
    // The learner reads the stem and options, then the reasoning for
    // their pick and for the strongest answer (about two rationales).
    total += readMinutes(
      words(item.scenario, item.stem, ...options.map(o => o.text)) + 2 * avgRationale
    ) + INTERACTION_MINUTES
  }
  return total
}

// A learner walks ONE path through a scenario. Estimate it by following
// the strongest choice at every decision (cycle-safe).
function scenarioMinutes(a) {
  const nodes = arr(a.nodes)
  const byId = new Map(nodes.map(n => [n.id, n]))
  let node = byId.get(a.start_node) || nodes[0]
  let total = readMinutes(words(a.setup))
  const seen = new Set()
  while (node && !seen.has(node.id) && seen.size < 12) {
    seen.add(node.id)
    total += readMinutes(words(node.situation))
    const choices = node.kind === 'decision' ? arr(node.choices) : []
    if (choices.length === 0) break
    const best = choices.find(c => c.quality === 'best') || choices[0]
    total += readMinutes(words(...choices.map(c => c.text), best.feedback)) + INTERACTION_MINUTES
    node = byId.get(best.next)
  }
  return total
}

function artifactMinutes(type, artifact) {
  try {
    if (type === 'flip-card-deck') return flipDeckMinutes(artifact)
    if (type === 'knowledge-check') return knowledgeCheckMinutes(artifact)
    if (type === 'scenario-branching') return scenarioMinutes(artifact)
  } catch {
    // fall through to the default if the artifact has an unexpected shape
  }
  return DEFAULT_ARTIFACT_MINUTES[type] ?? FALLBACK_ARTIFACT_MINUTES
}

function tabsMinutes(block) {
  const tabs = arr(block.tabs)
  if (block.state === 'proposed' || tabs.length === 0) return DEFAULT_TABS_MINUTES
  const wordCount = words(block.title, ...tabs.flatMap(t => [t.label, t.body]))
  return readMinutes(wordCount) + TAB_SWITCH_MINUTES * tabs.length
}

function blockMinutes(block, artifacts) {
  if (block.kind === 'tabs') return round1(tabsMinutes(block))
  if (block.kind === 'artifact') {
    const artifact = block.ref
      ? artifacts[artifactKey(block.ref.source, block.ref.artifact)]
      : null
    return round1(artifact
      ? artifactMinutes(block.artifact_type, artifact)
      : (DEFAULT_ARTIFACT_MINUTES[block.artifact_type] ?? FALLBACK_ARTIFACT_MINUTES))
  }
  if (block.kind === 'recall') {
    return round1(readMinutes(words(block.body, block.answer)) + INTERACTION_MINUTES)
  }
  // Only text a learner sees: a chunk shows its title; the hook and apply
  // titles are for the author and are not displayed.
  return round1(Math.max(0.1, readMinutes(block.kind === 'chunk' ? words(block.title, block.body) : words(block.body))))
}

// Returns a copy of the lesson with per-block minutes and totals added.
// `artifacts` is a map of artifactKey → artifact JSON (or null if missing).
function computeLesson(lesson, artifacts) {
  const blocks = arr(lesson.blocks).map(b => ({ ...b, minutes: blockMinutes(b, artifacts) }))
  let text = 0
  let art = 0
  let recall = 0
  for (const b of blocks) {
    if (b.kind === 'artifact') art += b.minutes
    else if (b.kind === 'recall') recall += b.minutes
    else text += b.minutes
  }
  const total = round1(text + art)
  const budget = lesson.time_budget_minutes
  return {
    ...lesson,
    blocks,
    text_minutes: round1(text),
    artifact_minutes: round1(art),
    recall_minutes: round1(recall),
    total_minutes: total,
    over_budget: total > budget,
  }
}

module.exports = {
  WORDS_PER_MINUTE,
  INTERACTION_MINUTES,
  DEFAULT_ARTIFACT_MINUTES,
  DEFAULT_TABS_MINUTES,
  TAB_SWITCH_MINUTES,
  artifactMinutes,
  blockMinutes,
  computeLesson,
}
