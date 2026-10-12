import { useState, useEffect, useMemo, useRef } from 'react'
import { shuffledOrder } from '../../lib/shuffle'
import './Renderer.css'

// Knowledge Check renderer.
//
// Retrieval-first: the learner reads a question and must COMMIT to an
// answer before any rationale exists on screen. Rationale text is only
// rendered once an answer is picked, and only for the picked option plus
// the strongest option. Other options' rationales are never rendered.
//
// Option order is shuffled here, once per attempt, so the correct
// answer's position carries no information. The model is asked to vary
// position too, but models favor certain positions; shuffling at
// render time guarantees it. The stored data is never modified.
//
// Contract (shared by every artifact renderer):
//   props.artifact — the parsed artifact.json for this type
//
// Defensive on purpose: if the model flags no option as correct, the
// item still works. The learner sees the rationale for what they chose
// and no "strongest answer" panel.

const LETTERS = ['A', 'B', 'C', 'D']

function makeOrders(items) {
  return items.map(item => shuffledOrder((item.options ?? []).length))
}

function Renderer({ artifact }) {
  const items = useMemo(() => artifact?.items ?? [], [artifact])

  const [orders, setOrders] = useState(() => makeOrders(items))
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState(null)   // original option index committed on this item
  const [results, setResults] = useState([])   // { text, strongest } per answered item
  const [done, setDone] = useState(false)

  const nextRef = useRef(null)
  const topRef = useRef(null)      // question counter / results heading, focused after moving on
  const moved = useRef(false)      // true once the learner has moved on or restarted

  // Start over (and reshuffle) whenever a different artifact is passed in
  useEffect(() => {
    setOrders(makeOrders(items))
    setIndex(0)
    setPicked(null)
    setResults([])
    setDone(false)
  }, [items])

  // After committing, move focus to Next so keyboard users land on the
  // reasoning and the next action.
  useEffect(() => {
    if (picked !== null) nextRef.current?.focus()
  }, [picked])

  // After Next or Try again, focus moves to the new question or the results
  // so a keyboard or screen reader user is not left on a button that is gone.
  useEffect(() => {
    if (moved.current) { moved.current = false; topRef.current?.focus() }
  }, [index, done])

  const item = items[index]
  if (!item) return <p style={{ color: '#6b6b6b' }}>No questions in this knowledge check.</p>

  const options = item.options ?? []
  const keyIdx = options.findIndex(o => o.correct === true)
  const order = orders[index] ?? options.map((_, i) => i)
  const chosen = picked !== null ? options[picked] : null
  const gotStrongest = picked !== null && picked === keyIdx
  const isLast = index === items.length - 1

  function commit(origIdx) {
    if (picked !== null) return   // answers are final for this question
    setPicked(origIdx)
  }

  function handleNext() {
    setResults(r => [...r, { text: chosen.text, strongest: gotStrongest }])
    setPicked(null)
    moved.current = true
    if (isLast) setDone(true)
    else setIndex(i => i + 1)
  }

  function restart() {
    moved.current = true
    setOrders(makeOrders(items))
    setIndex(0)
    setPicked(null)
    setResults([])
    setDone(false)
  }

  if (done) {
    const strongestCount = results.filter(r => r.strongest).length
    return (
      <div className="kc">
        <div className="kc-setup">
          <div className="kc-label">Your task</div>
          <p>{artifact.setup}</p>
        </div>

        <div className="kc-end">
          <div className="kc-label" ref={topRef} tabIndex={-1}>Your results</div>
          <p className="kc-stem">
            You chose the strongest answer on {strongestCount} of {results.length} questions.
          </p>

          <ol className="kc-summary">
            {results.map((r, i) => (
              <li key={i}>
                <span>{r.text}</span>
                <span className={`kc-badge ${r.strongest ? 'kc-badge-strong' : 'kc-badge-weaker'}`}>
                  {r.strongest ? 'Strongest answer' : 'A weaker answer'}
                </span>
              </li>
            ))}
          </ol>

          {artifact.apply_today && (
            <div className="kc-apply">
              <div className="kc-label">Apply today</div>
              <p>{artifact.apply_today}</p>
            </div>
          )}

          <button type="button" className="btn btn-secondary" onClick={restart}>
            Try again from the start
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="kc">
      <div className="kc-setup">
        <div className="kc-label">Your task</div>
        <p>{artifact.setup}</p>
      </div>

      <div className="kc-progress" ref={topRef} tabIndex={-1}>
        Question {index + 1} of {items.length}
        {artifact.estimated_minutes ? <>{' '}<span aria-hidden="true"> · </span>{' '}About {artifact.estimated_minutes} min</> : ''}
      </div>

      {item.scenario && <p className="kc-scenario">{item.scenario}</p>}
      <p className="kc-stem">{item.stem}</p>

      <div className="kc-options" role="group" aria-label="Answer options">
        {order.map((origIdx, pos) => (
          <button
            key={origIdx}
            type="button"
            className={`kc-option ${picked === origIdx ? 'chosen' : ''}`}
            onClick={() => commit(origIdx)}
            disabled={picked !== null}
            aria-pressed={picked === origIdx}
          >
            <span className="kc-letter">{LETTERS[pos]}</span>
            <span>{options[origIdx].text}</span>
          </button>
        ))}
      </div>

      {/* Reasoning exists in the DOM only after the learner commits */}
      <div aria-live="polite">
        {chosen && (
          <div className={`kc-feedback ${gotStrongest ? 'kc-feedback-strong' : 'kc-feedback-weaker'}`}>
            <div className="kc-feedback-quality">
              {gotStrongest ? 'Strongest answer' : 'A weaker answer'}
            </div>
            <p>{chosen.rationale}</p>

            {!gotStrongest && keyIdx !== -1 && (
              <div className="kc-key">
                <div className="kc-feedback-quality">The strongest answer</div>
                <p><strong>{options[keyIdx].text}</strong></p>
                <p>{options[keyIdx].rationale}</p>
              </div>
            )}

            <div className="kc-actions">
              <button
                ref={nextRef}
                type="button"
                className="btn btn-primary"
                onClick={handleNext}
              >
                {isLast ? 'See results' : 'Next question'} <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {!chosen && <p className="kc-hint">Choose an answer to see the reasoning.</p>}
    </div>
  )
}

export default Renderer
