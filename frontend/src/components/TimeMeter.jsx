// TimeMeter
//
// The live time meter for a lesson. The numbers come from the backend,
// which computes every minute from the actual content (text at 200 words
// per minute, 30 seconds per interaction), so the meter always matches
// what the learner would really spend. It is re-rendered from each
// response, so it updates the moment a block is added, replaced, or
// dismissed.
//
// Props: lesson — the lesson as returned by the API, with total_minutes,
// text_minutes, artifact_minutes, recall_minutes, over_budget and
// time_budget_minutes.
//
// Accessibility: the meter is an ESTIMATE FOR AUTHORS, never a time limit
// for learners. It is not a live region, so it does not chatter on every
// edit. The bar has a name and a text value, so a screen reader user can
// read the total on demand. A polite live region speaks only when the
// lesson goes over budget or comes back under it.

import { useEffect, useRef, useState } from 'react'

function TimeMeter({ lesson }) {
  const { total_minutes: total, time_budget_minutes: budget, over_budget: over } = lesson
  const pct = Math.min(100, Math.round((total / budget) * 100))
  const overBy = Math.round((total - budget) * 10) / 10
  const [announcement, setAnnouncement] = useState('')
  const wasOver = useRef(over)

  useEffect(() => {
    if (over === wasOver.current) return
    wasOver.current = over
    setAnnouncement(over
      ? `The lesson is now over its time budget: ${total} of ${budget} minutes.`
      : `The lesson is back within its time budget: ${total} of ${budget} minutes.`)
  }, [over, total, budget])

  return (
    <div className={`time-meter ${over ? 'time-meter-over' : ''}`}>
      <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
      <div className="time-meter-top">
        <span className="time-meter-label">
          <strong>{total}</strong> of {budget} min
        </span>
        <span className="time-meter-breakdown">
          Text {lesson.text_minutes}{' '}<span aria-hidden="true"> · </span>{' '}Artifacts {lesson.artifact_minutes}
          {' '}<span aria-hidden="true"> · </span>{' '}Recall {lesson.recall_minutes} (day 2, 7, 21, not counted)
        </span>
      </div>
      <div
        className="time-meter-bar"
        role="progressbar"
        aria-label="Lesson time estimate, for authors"
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-valuenow={Math.min(total, budget)}
        aria-valuetext={`${total} of ${budget} minutes${over ? ', over budget' : ''}`}
      >
        <div className="time-meter-fill" style={{ width: `${pct}%` }} />
      </div>
      {over && (
        <p className="time-meter-warning">
          Over budget by {overBy} min. Remove an artifact or shorten the text to get back to {budget} minutes.
        </p>
      )}
    </div>
  )
}

export default TimeMeter
