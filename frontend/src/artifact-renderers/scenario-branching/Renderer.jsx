import { useState, useEffect, useMemo, useRef } from 'react'
import './Renderer.css'

// Scenario Branching renderer.
//
// Retrieval-first: the learner reads a situation and must COMMIT to a
// choice before any feedback exists on screen. Feedback for a choice is
// only rendered once that choice is picked, and the other choices'
// feedback is never rendered at all. Once committed, the learner can
// continue down that branch or try a different choice (retry without
// shame), then repeat until an ending.
//
// Contract (shared by every artifact renderer):
//   props.artifact — the parsed artifact.json for this type
//
// Defensive on purpose: model output can contain a `next` that points
// nowhere. A dangling or missing `next` ends the path gracefully
// instead of crashing the page.

const QUALITY_LABEL = {
  best: 'Strongest choice',
  acceptable: 'Reasonable, with a cost',
  weak: 'Weaker choice',
}

function Renderer({ artifact }) {
  const nodes = useMemo(() => artifact?.nodes ?? [], [artifact])
  const byId = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes])
  const startId = (byId.get(artifact?.start_node) || nodes[0])?.id

  const [currentId, setCurrentId] = useState(startId)
  const [picked, setPicked] = useState(null)   // index of the committed choice at this node
  const [path, setPath] = useState([])         // decisions made so far: { text, quality }
  const [deadEnd, setDeadEnd] = useState(false)

  const continueRef = useRef(null)

  // Start over whenever a different artifact is passed in
  useEffect(() => {
    setCurrentId(startId)
    setPicked(null)
    setPath([])
    setDeadEnd(false)
  }, [artifact, startId])

  // After committing, move focus to Continue so keyboard users land on
  // the feedback and the next action.
  useEffect(() => {
    if (picked !== null) continueRef.current?.focus()
  }, [picked])

  const node = byId.get(currentId)
  if (!node) return <p style={{ color: '#6b6b6b' }}>No scenario content in this artifact.</p>

  const choices = node.kind === 'decision' ? node.choices ?? [] : []
  const isEnd = node.kind === 'ending' || choices.length === 0 || deadEnd
  const chosen = picked !== null ? choices[picked] : null

  function commit(i) {
    if (picked !== null) return   // already committed; use "Try a different choice"
    setPicked(i)
  }

  function handleContinue() {
    const next = chosen.next
    setPath(p => [...p, { text: chosen.text, quality: chosen.quality }])
    setPicked(null)
    if (next && byId.has(next)) setCurrentId(next)
    else setDeadEnd(true)
  }

  function restart() {
    setCurrentId(startId)
    setPicked(null)
    setPath([])
    setDeadEnd(false)
  }

  return (
    <div className="scenario">
      <div className="scenario-setup">
        <div className="scenario-label">Your task</div>
        <p>{artifact.setup}</p>
      </div>

      {!isEnd && (
        <>
          <div className="scenario-progress">
            Decision {path.length + 1}
            {artifact.estimated_minutes ? ` · ~${artifact.estimated_minutes} min` : ''}
          </div>

          <p className="scenario-situation">{node.situation}</p>

          <div className="scenario-choices" role="group" aria-label="Your options">
            {choices.map((choice, i) => (
              <button
                key={i}
                type="button"
                className={`scenario-choice ${picked === i ? 'chosen' : ''}`}
                onClick={() => commit(i)}
                disabled={picked !== null}
                aria-pressed={picked === i}
              >
                {choice.text}
              </button>
            ))}
          </div>

          {/* Feedback exists in the DOM only after the learner commits */}
          <div aria-live="polite">
            {chosen && (
              <div className={`scenario-feedback scenario-feedback-${chosen.quality}`}>
                <div className="scenario-feedback-quality">
                  {QUALITY_LABEL[chosen.quality] ?? 'Your choice'}
                </div>
                <p>{chosen.feedback}</p>
                <div className="scenario-actions">
                  <button
                    ref={continueRef}
                    type="button"
                    className="btn btn-primary"
                    onClick={handleContinue}
                  >
                    Continue →
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setPicked(null)}
                  >
                    Try a different choice
                  </button>
                </div>
              </div>
            )}
          </div>

          {!chosen && (
            <p className="scenario-hint">Choose an option to see what happens.</p>
          )}
        </>
      )}

      {isEnd && (
        <div className="scenario-end">
          <div className="scenario-label">How it played out</div>
          <p className="scenario-situation">
            {node.kind === 'ending' ? node.situation : 'That is the end of this path.'}
          </p>

          {path.length > 0 && (
            <ol className="scenario-summary">
              {path.map((step, i) => (
                <li key={i}>
                  <span>{step.text}</span>
                  <span className={`scenario-badge scenario-badge-${step.quality}`}>
                    {QUALITY_LABEL[step.quality] ?? 'Your choice'}
                  </span>
                </li>
              ))}
            </ol>
          )}

          {artifact.apply_today && (
            <div className="scenario-apply">
              <div className="scenario-label">Apply today</div>
              <p>{artifact.apply_today}</p>
            </div>
          )}

          <button type="button" className="btn btn-secondary" onClick={restart}>
            Try again from the start
          </button>
        </div>
      )}
    </div>
  )
}

export default Renderer
