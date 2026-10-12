import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../lib/apiFetch'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { usePageTitle } from '../hooks/usePageTitle'
import { actionPropsFor } from '../lib/errorActions'
import LoadingState from '../components/LoadingState'
import ErrorState from '../components/ErrorState'
import { Paragraphs } from '../components/LessonBlocks'
import { TabsView } from '../components/TabsBlock'
import { VisualDisplay } from '../components/VisualFields'
import { getRenderer, getTypeMeta } from '../artifact-renderers/registry'
import './Lesson.css'

// LessonPreview: the lesson exactly as a learner sees it.
//
// No authoring controls (Edit, Remove, Move, Insert, Regenerate), no time
// meter, no "Generated with" notes, no author briefs, no "No alt text yet"
// flags. Learners get the alt text and a "Describe this visual" button,
// a short "How to use this lesson" note, and every artifact in a state they
// can retry or restart without reloading the page.
//
// Only the "Back to editing" bar below is authoring chrome; it is not part
// of the lesson.

function RecallPrompt({ block }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="lesson-block lesson-block-recall">
      <h3>Day {block.recall_day} recall</h3>
      <p className="lesson-recall-question">{block.body}</p>
      {shown ? (
        <div className="lesson-recall-answer">
          <div className="lesson-label">Answer</div>
          <p>{block.answer}</p>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setShown(true)}
          aria-label={`Show answer, day ${block.recall_day} recall question`}
        >
          Show answer
        </button>
      )}
    </div>
  )
}

function LessonPreview() {
  const { projectSlug, lessonId } = useParams()
  const base = `/api/projects/${projectSlug}/lessons/${lessonId}`
  const [data, setData] = useState(null)
  const loadAction = useAsyncAction()

  const load = useCallback(async () => {
    const resp = await loadAction.run(() => api.get(base))
    if (resp) setData(resp)
  }, [loadAction, base])

  useEffect(() => { load() }, [base]) // eslint-disable-line react-hooks/exhaustive-deps

  usePageTitle(data ? `${data.lesson.title} (learner preview)` : undefined)

  if (loadAction.loading && !data) return <LoadingState message="Loading lesson..." />
  if (loadAction.error && !data) {
    return <ErrorState message={loadAction.error.userMessage} onRetry={load} {...actionPropsFor(loadAction.error.errorType)} />
  }
  if (!data) return null

  const { lesson, artifacts } = data
  const back = `/projects/${projectSlug}/lessons/${lessonId}`

  if (lesson.status !== 'drafted') {
    return (
      <div className="lesson-page">
        <h1>{lesson.title}</h1>
        <p>This lesson has no text yet, so there is nothing to preview.</p>
        <Link to={back} className="btn btn-primary">Back to editing</Link>
      </div>
    )
  }

  const body = lesson.blocks.filter(b => b.kind !== 'recall')
  const recall = lesson.blocks.filter(b => b.kind === 'recall')

  return (
    <div className="lesson-page learner-lesson">
      <div className="preview-bar">
        <span>Previewing as a learner.</span>
        <Link to={back} className="btn btn-secondary btn-sm">Back to editing</Link>
      </div>

      <h1>{lesson.title}</h1>
      {lesson.objective && <p className="lesson-objective"><strong>Objective:</strong> {lesson.objective}</p>}

      <section className="lesson-block" aria-labelledby="how-to-use">
        <h2 id="how-to-use">How to use this lesson</h2>
        <ul>
          <li>You can do everything with the keyboard. Press Tab to move forward and Shift and Tab to go back. Press Enter or Space to press a button.</li>
          <li>Flip cards: press Reveal answer to see the other side, and Show question to turn it back. Press Previous card or Next card to change cards. The left and right arrow keys work too.</li>
          <li>Tabs: Tab to the tab list. Then use the left and right arrow keys to change tabs. Home and End go to the first and last tab.</li>
          <li>Scenarios and knowledge checks: pick one option, read the feedback, then press the button to go on. At the end you can try again from the start.</li>
          <li>There is no time limit. Take as long as you need.</li>
        </ul>
      </section>

      {body.map(block => {
        if (block.kind === 'hook') {
          return (
            <section key={block.id} className="lesson-block lesson-block-hook" aria-label="Start here">
              <div className="lesson-body"><Paragraphs text={block.body} /></div>
            </section>
          )
        }
        if (block.kind === 'chunk') {
          return (
            <section key={block.id} className="lesson-block lesson-block-chunk">
              <h2 className="lesson-chunk-title">{block.title}</h2>
              <div className="lesson-body"><Paragraphs text={block.body} /></div>
              <VisualDisplay item={block} learner />
            </section>
          )
        }
        if (block.kind === 'apply') {
          return (
            <section key={block.id} className="lesson-block lesson-block-apply" aria-labelledby={`${block.id}-h`}>
              <h2 id={`${block.id}-h`} className="lesson-chunk-title">Apply today</h2>
              <div className="lesson-body"><Paragraphs text={block.body} /></div>
            </section>
          )
        }
        if (block.kind === 'tabs') {
          if (block.state !== 'ready') return null
          return (
            <section key={block.id} className="lesson-block lesson-tabs-block" aria-label={block.title || 'Tabs'}>
              {block.title && <h2 className="lesson-chunk-title">{block.title}</h2>}
              <TabsView block={block} learner />
            </section>
          )
        }
        if (block.kind === 'artifact') {
          const artifact = block.ref ? artifacts[`${block.ref.source}/${block.ref.artifact}`] : null
          if (block.state !== 'ready' || !artifact || block.unavailable) return null
          const Renderer = getRenderer(block.artifact_type)
          return (
            <section key={block.id} className="lesson-block lesson-artifact" aria-label={getTypeMeta(block.artifact_type).label}>
              <Renderer artifact={artifact} />
            </section>
          )
        }
        return null
      })}

      {recall.length > 0 && (
        <section aria-labelledby="recall-h">
          <h2 id="recall-h">Come back and recall</h2>
          <p>Try these questions on day 2, day 7, and day 21. Answer from memory first, then check.</p>
          {recall.map(b => <RecallPrompt key={b.id} block={b} />)}
        </section>
      )}
    </div>
  )
}

export default LessonPreview
