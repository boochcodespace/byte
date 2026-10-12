// frontend/src/lib/shuffle.js
//
// Random display order for a list of answer options. Returns an array
// of the ORIGINAL indexes, shuffled (Fisher-Yates). Renderers keep the
// stored artifact untouched and map through this order when drawing, so
// the position of the correct answer carries no information. Models
// tend to favor certain positions for the correct answer, so this is
// done at render time instead of trusting the prompt alone.

export function shuffledOrder(length) {
  const order = Array.from({ length }, (_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}
