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

function TimeMeter({ lesson }) {
  const { total_minutes: total, time_budget_minutes: budget, over_budget: over } = lesson
  const pct = Math.min(100, Math.round((total / budget) * 100))
  const overBy = Math.round((total - budget) * 10) / 10

  return (
    <div className={`time-meter ${over ? 'time-meter-over' : ''}`} role="status" aria-live="polite">
      <div className="time-meter-top">
        <span className="time-meter-label">
          <strong>{total}</strong> of {budget} min
        </span>
        <span className="time-meter-breakdown">
          Text {lesson.text_minutes} · Artifacts {lesson.artifact_minutes}
          {' · '}Recall {lesson.recall_minutes} (day 2, 7, 21, not counted)
        </span>
      </div>
      <div
        className="time-meter-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-valuenow={total}
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
