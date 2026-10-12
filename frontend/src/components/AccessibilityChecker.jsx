import { useState, useRef, useEffect } from 'react'
import { api } from '../lib/apiFetch'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { actionPropsFor } from '../lib/errorActions'
import LoadingState from './LoadingState'
import ErrorState from './ErrorState'

// The lesson accessibility checker, on demand.
//
// Lists what is wrong for a learner who cannot see the screen, use a mouse,
// or tell colors apart, in plain language, with a Fix button that takes the
// author to the block. An issue the author has looked at and is happy with
// can be marked as reviewed, with a reason; that review lasts only while the
// text that triggered it stays the same.
//
// Props:
//   base       API base for this lesson
//   stamp      changes whenever the lesson changes (shows a "run again" note)
//   onFix(issue)   go to the block and open what fixes it

const RULE_TITLE = {
  'missing-alt-text': 'missing alt text',
  'decorative-no-reason': 'decorative visual without a reason',
  'alt-text-long': 'long alt text',
  'deck-missing-alt-text': 'flip deck without alt text',
  'missing-heading': 'missing heading',
  'heading-reads-like-text': 'heading that reads like text',
  'color-only-reference': 'color, position or shape reference',
  'vague-link-text': 'vague link text',
  'empty-link-text': 'empty link text',
  'reading-level': 'reading level',
  'acronym-not-spelled-out': 'acronym not spelled out',
  'preview-skipped-proposal': 'suggestion learners will not see',
  'preview-skipped-missing-artifact': 'missing artifact',
  'preview-skipped-visual': 'visual learners will not see',
}
const SEVERITY_LABEL = { error: 'Error', warning: 'Warning', note: 'Note' }
const FIX_LABEL = { edit: 'Fix', regenerate: 'Fix', resolve: 'Fix', none: null }

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function Issue({ issue, onFix, onReview, busy }) {
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const fixLabel = FIX_LABEL[issue.fix]
  const title = (RULE_TITLE[issue.rule] || issue.rule) + (issue.detail ? ` "${issue.detail}"` : '')
  const askBtn = useRef(null)
  const wasAsking = useRef(false)
  useEffect(() => {
    if (wasAsking.current && !asking) askBtn.current?.focus()
    wasAsking.current = asking
  }, [asking])

  async function save(e) {
    e.preventDefault()
    const ok = await onReview(issue, reason)
    if (ok) setAsking(false)
  }

  return (
    <li className={`a11y-issue a11y-${issue.severity}`}>
      <p className="a11y-issue-head">
        <strong className="a11y-severity">{SEVERITY_LABEL[issue.severity]}</strong>{' '}
        <span className="a11y-where">{issue.where}</span>
      </p>
      <p>{issue.message}</p>
      <div className="lesson-actions">
        {fixLabel && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => onFix(issue)}
            disabled={busy}
            aria-label={`Fix ${title} in ${issue.where}`}
          >
            {fixLabel}
          </button>
        )}
        {!asking && (
          <button
            type="button"
            ref={askBtn}
            className="btn btn-secondary btn-sm"
            onClick={() => setAsking(true)}
            disabled={busy}
            aria-label={`Mark ${title} in ${issue.where} as reviewed`}
          >
            Mark as reviewed
          </button>
        )}
      </div>
      {asking && (
        <form className="a11y-review-form" onSubmit={save} aria-label={`Review ${title} in ${issue.where}`}>
          <div className="form-group">
            <label>
              Why is this fine?
              <input type="text" value={reason} onChange={e => setReason(e.target.value)} autoFocus required />
            </label>
            <p className="field-help">A reason is required. The review ends if the text changes.</p>
          </div>
          <div className="lesson-actions">
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !reason.trim()}>Save review</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAsking(false)}>Cancel</button>
          </div>
        </form>
      )}
    </li>
  )
}

function AccessibilityChecker({ base, stamp, onFix, disabled }) {
  const [report, setReport] = useState(null)
  const [ranAt, setRanAt] = useState(null)       // the lesson stamp the report was made for
  const [message, setMessage] = useState('')
  const checkAction = useAsyncAction()
  const reviewAction = useAsyncAction()
  const headingRef = useRef(null)

  async function run() {
    const resp = await checkAction.run(() => api.get(`${base}/a11y`))
    if (resp) {
      setReport(resp)
      setRanAt(stamp)
      const s = resp.summary
      setMessage(s.open === 0
        ? 'Accessibility check finished. No open problems.'
        : `Accessibility check finished: ${plural(s.errors, 'error')}, ${plural(s.warnings, 'warning')}, ${plural(s.notes, 'note')}.`)
      setTimeout(() => headingRef.current?.focus(), 0)
    }
  }

  async function review(issue, reason) {
    const resp = await reviewAction.run(() => api.put(`${base}/a11y/reviews`, { key: issue.key, reason }))
    if (resp) {
      setReport(resp)
      setRanAt(stamp)
      setMessage(reason ? `Marked as reviewed: ${RULE_TITLE[issue.rule]}${issue.detail ? ` "${issue.detail}"` : ''} in ${issue.where}.` : 'Review removed.')
      return true
    }
    return false
  }

  const stale = report && ranAt !== stamp
  const open = report ? report.issues.filter(i => !i.reviewed) : []
  const reviewed = report ? report.issues.filter(i => i.reviewed) : []
  const content = open.filter(i => i.category === 'content')
  const skipped = open.filter(i => i.category === 'preview')
  const busy = disabled || checkAction.loading || reviewAction.loading

  return (
    <section className="card lesson-card a11y-checker" aria-labelledby="a11y-h">
      <div className="a11y-checker-top">
        <h2 id="a11y-h" tabIndex={-1} ref={headingRef}>Accessibility check</h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={run} disabled={busy}>
          {checkAction.loading ? 'Checking...' : report ? 'Run the check again' : 'Check accessibility'}
        </button>
      </div>
      <p className="field-help">
        Checks alt text, headings, color and position references, link text, and what learners will not see.
        Run it before you share or export the lesson.
      </p>
      <div className="sr-only" role="status" aria-live="polite">{message}</div>

      {checkAction.loading && <LoadingState subtle message="Checking the lesson..." />}
      {checkAction.error && (
        <ErrorState message={checkAction.error.userMessage} onRetry={run} {...actionPropsFor(checkAction.error.errorType)} />
      )}
      {reviewAction.error && <ErrorState message={reviewAction.error.userMessage} {...actionPropsFor(reviewAction.error.errorType)} />}

      {report && (
        <>
          {stale && (
            <p className="status-message error" role="status">
              The lesson has changed since this check. Run the check again.
            </p>
          )}
          <p className="a11y-summary">
            <strong>{report.summary.open === 0 ? 'No open problems.' : `${plural(report.summary.errors, 'error')}, ${plural(report.summary.warnings, 'warning')}, ${plural(report.summary.notes, 'note')} open.`}</strong>
            {report.summary.reviewed > 0 && ` ${report.summary.reviewed} reviewed.`}
          </p>

          {content.length > 0 && (
            <>
              <h3>Problems in the content</h3>
              <ul className="a11y-list">
                {content.map(i => <Issue key={i.key} issue={i} onFix={onFix} onReview={review} busy={busy} />)}
              </ul>
            </>
          )}
          {skipped.length > 0 && (
            <>
              <h3>Blocks learners will not see</h3>
              <ul className="a11y-list">
                {skipped.map(i => <Issue key={i.key} issue={i} onFix={onFix} onReview={review} busy={busy} />)}
              </ul>
            </>
          )}
          {reviewed.length > 0 && (
            <>
              <h3>Reviewed</h3>
              <ul className="a11y-list">
                {reviewed.map(i => (
                  <li key={i.key} className="a11y-issue a11y-reviewed">
                    <p className="a11y-issue-head">
                      <strong className="a11y-severity">Reviewed</strong>{' '}
                      <span className="a11y-where">{i.where}</span>
                    </p>
                    <p>{RULE_TITLE[i.rule]}{i.detail ? ` "${i.detail}"` : ''}. Reason: {i.review_reason}</p>
                    <div className="lesson-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => review(i, '')}
                        disabled={busy}
                        aria-label={`Undo the review of ${RULE_TITLE[i.rule]}${i.detail ? ` "${i.detail}"` : ''} in ${i.where}`}
                      >
                        Undo review
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  )
}

export default AccessibilityChecker
