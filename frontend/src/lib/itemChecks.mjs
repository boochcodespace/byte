// Item-writing checks for one knowledge check question, shown as ADVISORY
// notes in the editor. They never block saving. The rules come from the item
// writing rules the generator follows (Byte's system prompt):
//
//   - the key is not the longest option (length gives it away)
//   - no letter or position references (learners see the options shuffled)
//   - no "all of the above", "none of the above", or "A and B" combinations
//   - a stem is not worded in the negative (NOT, EXCEPT, LEAST)
//   - no absolute words that signal a wrong answer (always, never, only ...)
//   - no two options say the same thing
//
// A plain module (.mjs) with no imports, so the page and the tests share it.

const LETTERS = 'ABCDEFGH'

const LETTER_REF = /\b(?:option|answer|choice|response)\s+[A-D]\b/i
const POSITION_REF = /\b(?:the\s+)?(?:first|second|third|fourth|last|previous|above|below|top|bottom)\s+(?:option|answer|choice)\b/i
const POSITION_REF_2 = /\b(?:options?|answers?|choices?)\s+(?:above|below)\b/i
const ALL_NONE = /\b(?:all|none)\s+of\s+the\s+above\b/i
const COMBO = /\b(?:both\s+)?(?:options?\s+)?[A-D]\s+and\s+[A-D]\b/
const NEGATIVE_STEM = /\b(?:NOT|EXCEPT|LEAST)\b|\bwhich\s+(?:of\s+the\s+following\s+)?(?:is|are)\s+not\b/
const ABSOLUTES = /\b(?:always|never|only|every|none|completely|all)\b/i

const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

export function checkItem(item) {
  const notes = []
  const options = item.options || []
  const key = options.findIndex(o => o.correct === true)

  if (key !== -1 && options.length > 1) {
    const keyLen = (options[key].text || '').length
    const longest = options.every((o, i) => i === key || (o.text || '').length < keyLen)
    if (longest) {
      notes.push({
        id: 'key-longest',
        message: `The key (option ${LETTERS[key]}) is the longest option. Learners can pick it by length alone. Shorten it or lengthen the others.`,
      })
    }
  }

  const spots = [
    ['the question', item.stem],
    ['the scenario', item.scenario],
    ...options.flatMap((o, i) => [[`option ${LETTERS[i]}`, o.text], [`option ${LETTERS[i]}'s explanation`, o.rationale]]),
  ]
  for (const [where, text] of spots) {
    if (!text) continue
    const hit = text.match(LETTER_REF) || text.match(POSITION_REF) || text.match(POSITION_REF_2)
    if (hit) {
      notes.push({
        id: 'position-reference',
        message: `${where[0].toUpperCase()}${where.slice(1)} says "${hit[0]}". Learners see the options in a shuffled order, so a letter or position points at the wrong option. Name the option by what it says.`,
      })
    }
  }
  for (const [i, o] of options.entries()) {
    const text = o.text || ''
    if (ALL_NONE.test(text) || COMBO.test(text)) {
      notes.push({
        id: 'all-none-combo',
        message: `Option ${LETTERS[i]} is an "all of the above", "none of the above", or "A and B" answer. Give each option its own complete answer instead.`,
      })
    }
    if (ABSOLUTES.test(text)) {
      notes.push({
        id: 'absolute-word',
        message: `Option ${LETTERS[i]} uses an absolute word ("${text.match(ABSOLUTES)[0]}"). Absolutes often mark a wrong answer, so careful learners can rule it out without knowing the content.`,
      })
    }
  }
  if (item.stem && NEGATIVE_STEM.test(item.stem)) {
    notes.push({
      id: 'negative-stem',
      message: 'The question is worded in the negative (NOT, EXCEPT, LEAST). Ask what to do, not what to avoid.',
    })
  }
  const seen = new Map()
  options.forEach((o, i) => {
    const n = norm(o.text)
    if (!n) return
    if (seen.has(n)) {
      notes.push({ id: 'duplicate-options', message: `Options ${LETTERS[seen.get(n)]} and ${LETTERS[i]} say the same thing.` })
    } else seen.set(n, i)
  })
  return notes
}

// How many of an item's options are marked as the key.
export const keyCount = item => (item.options || []).filter(o => o.correct === true).length
