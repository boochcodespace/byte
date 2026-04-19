import { useState, useEffect, useCallback } from 'react'

// FlipCardDeck: interactive card-by-card renderer for a flip card artifact.
//
// Interactions:
//   Click card   — flip between front and back
//   ← →  keys   — navigate previous / next card
//   Space key    — flip current card
//   Dot nav      — jump to any card directly

function FlipCardDeck({ artifact, projectSlug, sourceSlug }) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  // Cards whose image failed to load — keyed by index so only that card
  // falls back to text-only, rather than hiding images across the deck.
  const [imageFailed, setImageFailed] = useState({})

  const cards = artifact?.cards ?? []
  const total = cards.length
  const card = cards[currentIndex]

  // Navigate to a new card: unflip first so you always see the front
  const goTo = useCallback((index) => {
    setFlipped(false)
    // Small delay so the unflip animation starts before the content changes
    setTimeout(() => setCurrentIndex(index), 150)
  }, [])

  const goNext = useCallback(() => {
    if (currentIndex < total - 1) goTo(currentIndex + 1)
  }, [currentIndex, total, goTo])

  const goPrev = useCallback(() => {
    if (currentIndex > 0) goTo(currentIndex - 1)
  }, [currentIndex, goTo])

  // Keyboard navigation — only active when the deck element is focused
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); goNext() }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); goPrev() }
    if (e.key === ' ')          { e.preventDefault(); setFlipped(f => !f) }
  }, [goNext, goPrev])

  // Reset to card 1 whenever a new artifact is passed in (e.g. user picks a different deck)
  useEffect(() => {
    setCurrentIndex(0)
    setFlipped(false)
    setImageFailed({})
  }, [artifact])

  // Build the media URL for a card's source image. Returns null when the
  // card has no visual reference, the props we'd need are missing, or
  // the image previously failed to load (stale-cache / 404).
  const mediaUrlFor = (c, idx) => {
    if (!c?.visual_filename) return null
    if (!projectSlug || !sourceSlug) return null
    if (imageFailed[idx]) return null
    return `/api/projects/${projectSlug}/sources/${sourceSlug}/media/${encodeURIComponent(c.visual_filename)}`
  }

  if (!card) return <p style={{ color: '#6b6b6b' }}>No cards in this deck.</p>

  // Human-readable label for the card type badge
  const TYPE_LABEL = {
    hook:    '🎣 Hook',
    content: '📚 Content',
    apply:   '✅ Apply Today'
  }

  return (
    // tabIndex={0} makes this div focusable so keyboard events fire on it
    <div className="flipcard-deck" onKeyDown={handleKeyDown} tabIndex={0}>

      {/* Deck header: counter + estimated time */}
      <div className="flipcard-deck-meta">
        <div className="flipcard-deck-info">
          <span className="flipcard-counter">{currentIndex + 1} / {total}</span>
          <span className="flipcard-time">~{artifact.estimated_minutes} min</span>
        </div>
      </div>

      {/* ── The flip card ── */}
      {/* CSS perspective + rotateY gives the 3-D flip effect.         */}
      {/* The .flipped class on the outer div triggers the rotation.   */}
      <div
        className={`flipcard flipcard-type-${card.type} ${flipped ? 'flipped' : ''}`}
        onClick={() => setFlipped(f => !f)}
        role="button"
        aria-label={flipped ? 'Show front of card' : 'Reveal answer'}
      >
        <div className="flipcard-inner">

          {/* Front face */}
          <div className="flipcard-front">
            <div className="flipcard-type-badge">
              {TYPE_LABEL[card.type] ?? card.type}
            </div>
            <CardImage card={card} mediaUrl={mediaUrlFor(card, currentIndex)} onFail={() => setImageFailed(f => ({ ...f, [currentIndex]: true }))} />
            <div className="flipcard-text">{card.front}</div>
            <div className="flipcard-hint">Click to reveal →</div>
          </div>

          {/* Back face — rotated 180° in CSS, flips into view */}
          <div className="flipcard-back">
            <div className="flipcard-type-badge">
              {TYPE_LABEL[card.type] ?? card.type}
            </div>
            <CardImage card={card} mediaUrl={mediaUrlFor(card, currentIndex)} onFail={() => setImageFailed(f => ({ ...f, [currentIndex]: true }))} />
            <div className="flipcard-text">{card.back}</div>
            <div className="flipcard-hint">← Click to flip back</div>
          </div>

        </div>
      </div>

      {/* Navigation row */}
      <div className="flipcard-nav">
        <button
          className="btn btn-secondary"
          onClick={goPrev}
          disabled={currentIndex === 0}
          aria-label="Previous card"
        >
          ← Prev
        </button>

        {/* Dot indicators — click any dot to jump to that card */}
        <div className="flipcard-progress" role="tablist" aria-label="Card navigation">
          {cards.map((_, i) => (
            <button
              key={i}
              className={`flipcard-dot ${i === currentIndex ? 'active' : ''}`}
              onClick={() => goTo(i)}
              aria-label={`Card ${i + 1}`}
              aria-selected={i === currentIndex}
              role="tab"
            />
          ))}
        </div>

        <button
          className="btn btn-secondary"
          onClick={goNext}
          disabled={currentIndex === total - 1}
          aria-label="Next card"
        >
          Next →
        </button>
      </div>

      <p className="flipcard-keyboard-hint">
        ← → arrow keys to navigate · Space to flip
      </p>

      {/* Visual anchor suggestion from Claude */}
      {artifact.visual_anchor_description && (
        <div className="flipcard-visual-anchor">
          <strong>Visual anchor: </strong>{artifact.visual_anchor_description}
        </div>
      )}

      {/* Spaced repetition advice from Claude */}
      {artifact.spaced_repetition_notes && (
        <div className="flipcard-spaced-rep">
          <strong>Spaced repetition tip: </strong>{artifact.spaced_repetition_notes}
        </div>
      )}
    </div>
  )
}

// Renders the source-image block on a card face when the card references
// an image. Missing/null visual_filename → renders nothing (no empty slot).
// Backend-annotated visual_source_position gives the caption ("Source:
// slide 3"); when absent we fall back to the filename so old artifacts
// still show something sensible.
function CardImage({ card, mediaUrl, onFail }) {
  if (!mediaUrl) return null
  const caption = card.visual_source_position || card.visual_filename
  return (
    <div className="flipcard-image-wrap">
      <img
        src={mediaUrl}
        alt=""
        loading="lazy"
        onError={() => {
          console.warn('[flipcard] source image failed to load:', mediaUrl)
          onFail()
        }}
      />
      <div className="flipcard-image-caption">Source: {caption}</div>
    </div>
  )
}

export default FlipCardDeck
