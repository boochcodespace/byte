// Writing checks for one flip card, shown as ADVISORY notes in the editor. They
// never block saving. They come from Byte's flip card rules:
//
//   - the front asks or cues; it does not give away the back
//   - front 20 words or fewer, back 25 words or fewer
//   - a card stands alone: no "see the previous card"
//   - no two cards share a front
//
// A plain module (.mjs) with no imports, so the page and the tests share it.

export const FRONT_LIMIT = 20
export const BACK_LIMIT = 25

const STOP = new Set(['about', 'after', 'again', 'also', 'always', 'because', 'been', 'before', 'being', 'between', 'both', 'could', 'does', 'doing', 'each', 'from', 'have', 'into', 'just', 'like', 'make', 'many', 'more', 'most', 'much', 'must', 'only', 'other', 'over', 'same', 'should', 'some', 'such', 'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'under', 'until', 'very', 'what', 'when', 'where', 'which', 'while', 'will', 'with', 'would', 'your', 'you'])
const words = t => (String(t || '').toLowerCase().match(/[a-z][a-z'-]*/g) || [])
const content = t => words(t).filter(w => w.length >= 4 && !STOP.has(w))
export const wordCount = t => (String(t || '').trim() ? String(t).trim().split(/\s+/).length : 0)

const OTHER_CARD = /\b(?:previous|next|earlier|last|above|following|preceding)\s+card\b|\bcard\s+\d+\b/i
const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()   // letters and digits, so "card 1" and "card 2" differ

export function checkCard(card, allCards = []) {
  const notes = []
  const front = card.front || ''
  const back = card.back || ''

  const fw = wordCount(front)
  const bw = wordCount(back)
  if (fw > FRONT_LIMIT) {
    notes.push({ id: 'front-long', message: `The front is ${fw} words. Fronts read best at ${FRONT_LIMIT} or fewer, so the learner can answer from memory.` })
  }
  if (bw > BACK_LIMIT) {
    notes.push({ id: 'back-long', message: `The back is ${bw} words. Backs read best at ${BACK_LIMIT} or fewer, so one idea sticks.` })
  }

  const backWords = [...new Set(content(back))]
  if (backWords.length >= 3) {
    const inFront = new Set(content(front))
    const shared = backWords.filter(w => inFront.has(w))
    if (shared.length / backWords.length >= 0.6) {
      notes.push({ id: 'front-gives-away-back', message: 'The front repeats most of the words on the back, so it gives the answer away. Ask a question or give a cue instead of stating the answer.' })
    }
  }
  const nf = norm(front), nb = norm(back)
  if (nb.length > 8 && nf.includes(nb) && !notes.some(n => n.id === 'front-gives-away-back')) {
    notes.push({ id: 'front-gives-away-back', message: 'The front contains the whole back. Ask a question or give a cue instead of stating the answer.' })
  }

  if (OTHER_CARD.test(front) || OTHER_CARD.test(back)) {
    notes.push({ id: 'other-card', message: 'This card points at another card ("previous card", "next card", "card 2"). Each card must stand alone, because learners can start anywhere and come back later.' })
  }

  const dup = allCards.filter(c => c !== card && norm(c.front) && norm(c.front) === norm(front)).length
  if (dup) notes.push({ id: 'duplicate-front', message: 'Another card has the same front.' })

  return notes
}
