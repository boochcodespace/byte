import { useState, useEffect, useCallback, useRef } from 'react'
import './Renderer.css'

// Flip Card Deck renderer.
//
// Interactions (all work with the keyboard alone):
//   Reveal answer / Show question   real buttons inside each card face
//   Previous / Next                 buttons below the card
//   Card 1, Card 2 ...              buttons that jump to a card
//   Left and right arrow keys       move between cards while focus is in the deck
//
// Accessibility:
//   - Only the side being shown is exposed to assistive technology. The
//     other face is aria-hidden and inert, so the answer is not read out
//     before it is revealed.
//   - A polite live region announces the new card and the revealed side.
//   - After a flip, focus moves to the button on the side now showing, so
//     it is never lost to a hidden control.
//   - The 3-D animation is switched off by prefers-reduced-motion (see
//     index.css).
//
// Contract (shared by every artifact renderer):
//   props.artifact — the parsed artifact.json for this type
//
// Unknown fields on `artifact` or `card` are ignored, which is how
// backward compatibility works: older artifacts with dead fields
// render cleanly.

const TYPE_LABEL = {
  hook:    '🎣 Hook',
  content: '📚 Content',
  apply:   '✅ Apply Today',
}

function Renderer({ artifact }) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const frontBtn = useRef(null)
  const backBtn = useRef(null)
  const userFlipped = useRef(false)

  const cards = artifact?.cards ?? []
  const total = cards.length
  const card = cards[currentIndex]

  // Navigate to a new card: unflip first so you always see the front
  const goTo = useCallback((index) => {
    setFlipped(false)
    // Small delay so the unflip animation starts before the content changes
    setTimeout(() => {
      setCurrentIndex(index)
      const c = (artifact?.cards ?? [])[index]
      if (c) setAnnouncement(`Card ${index + 1} of ${(artifact?.cards ?? []).length}. ${c.front}`)
    }, 150)
  }, [artifact])

  const goNext = useCallback(() => {
    if (currentIndex < total - 1) goTo(currentIndex + 1)
  }, [currentIndex, total, goTo])

  const goPrev = useCallback(() => {
    if (currentIndex > 0) goTo(currentIndex - 1)
  }, [currentIndex, goTo])

  const flip = useCallback(() => {
    userFlipped.current = true
    setFlipped(f => {
      const next = !f
      setAnnouncement(next ? `Answer. ${card?.back ?? ''}` : `Question. ${card?.front ?? ''}`)
      return next
    })
  }, [card])

  // After the user flips, put focus on the button of the side now showing.
  useEffect(() => {
    if (!userFlipped.current) return
    userFlipped.current = false
    ;(flipped ? backBtn : frontBtn).current?.focus()
  }, [flipped])

  // Arrow keys move between cards while focus is anywhere inside the deck.
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); goNext() }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); goPrev() }
  }, [goNext, goPrev])

  // Reset to card 1 whenever a new artifact is passed in
  useEffect(() => {
    setCurrentIndex(0)
    setFlipped(false)
    setAnnouncement('')
  }, [artifact])

  if (!card) return <p>No cards in this deck.</p>

  const badge = TYPE_LABEL[card.type] ?? card.type

  return (
    <div className="flipcard-deck" role="group" aria-label="Flip card deck" onKeyDown={handleKeyDown}>

      {/* Deck header: counter + estimated time */}
      <div className="flipcard-deck-meta">
        <div className="flipcard-deck-info">
          <span className="flipcard-counter">Card {currentIndex + 1} of {total}</span>
          <span className="flipcard-time">About {artifact.estimated_minutes} min</span>
        </div>
      </div>

      {/* ── The flip card ── */}
      {/* A click anywhere on the card still flips it for mouse users;     */}
      {/* keyboard and screen-reader users use the real buttons inside.    */}
      <div
        className={`flipcard flipcard-type-${card.type} ${flipped ? 'flipped' : ''}`}
        onClick={flip}
      >
        <div className="flipcard-inner">

          {/* Front face */}
          <div className="flipcard-front" aria-hidden={flipped} inert={flipped ? '' : undefined}>
            <div className="flipcard-type-badge">{badge}</div>
            <div className="flipcard-text">{card.front}</div>
            <div className="flipcard-hint">
              <button
                type="button"
                ref={frontBtn}
                className="flipcard-flip"
                onClick={(e) => { e.stopPropagation(); flip() }}
              >
                Reveal answer
              </button>
            </div>
          </div>

          {/* Back face — rotated 180° in CSS, flips into view */}
          <div className="flipcard-back" aria-hidden={!flipped} inert={!flipped ? '' : undefined}>
            <div className="flipcard-type-badge">{badge}</div>
            <div className="flipcard-text">{card.back}</div>
            <div className="flipcard-hint">
              <button
                type="button"
                ref={backBtn}
                className="flipcard-flip"
                onClick={(e) => { e.stopPropagation(); flip() }}
              >
                Show question
              </button>
            </div>
          </div>

        </div>
      </div>

      <div className="sr-only" role="status" aria-live="polite">{announcement}</div>

      {/* Navigation row */}
      <div className="flipcard-nav">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={goPrev}
          disabled={currentIndex === 0}
        >
          Previous card
        </button>

        {/* Dot buttons: jump to any card */}
        <div className="flipcard-progress" role="group" aria-label="Jump to a card">
          {cards.map((_, i) => (
            <button
              type="button"
              key={i}
              className="flipcard-dot"
              onClick={() => goTo(i)}
              aria-label={`Card ${i + 1} of ${total}`}
              aria-current={i === currentIndex ? 'true' : undefined}
            />
          ))}
        </div>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={goNext}
          disabled={currentIndex === total - 1}
        >
          Next card
        </button>
      </div>

      <p className="flipcard-keyboard-hint">
        Use the buttons, or press the left and right arrow keys to change cards.
      </p>
    </div>
  )
}

export default Renderer
