import { useState, useId } from 'react'
import GrowTextarea from './GrowTextarea'
import { Paragraphs } from './LessonBlocks'

// Visual notes and their text alternatives.
//
// A visual note is a brief for whoever draws the visual. Every visual that
// carries meaning also needs a text alternative a screen reader can read:
//
//   alt_text           one sentence; 125 characters is a soft guide
//   long_description   optional, for diagrams and comparisons
//   decorative         true + decorative_reason, for a visual with no meaning
//
//   VisualEditor   the fields in an editor (chunk or one tab)
//   VisualDisplay  what the lesson page shows for a chunk or tab

const ALT_SOFT_LIMIT = 125

export function VisualEditor({ scope = '', value, onChange, busy, onDraft }) {
  const id = useId()
  const [drafting, setDrafting] = useState(false)
  const [drafted, setDrafted] = useState(false)
  const [error, setError] = useState('')
  const label = base => (scope ? `${scope} ${base.toLowerCase()}` : base)
  const brief = value.visual || ''
  const alt = value.alt_text || ''

  async function draft() {
    setDrafting(true)
    setError('')
    try {
      const out = await onDraft(brief)
      const d = out?.draft || {}
      onChange({ alt_text: d.alt_text || '', long_description: d.long_description || '', decorative: false, decorative_reason: '' })
      setDrafted(true)
    } catch (e) {
      setError(e?.userMessage || 'Byte could not draft the alt text. Try again, or write it yourself.')
    } finally {
      setDrafting(false)
    }
  }

  return (
    <>
      <div className="form-group">
        <label>
          {label('Visual note')} <span className="label-optional">(optional)</span>
          <GrowTextarea value={brief} onChange={e => onChange({ visual: e.target.value })} disabled={busy} />
        </label>
      </div>

      {brief.trim() && (
        <fieldset className="visual-alt" disabled={busy}>
          <legend>{label('Text alternative')}</legend>

          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={!!value.decorative}
                onChange={e => onChange({ decorative: e.target.checked })}
              />{' '}
              {scope ? `${scope}: ` : ''}This visual is decorative. It adds no meaning.
            </label>
          </div>

          {value.decorative ? (
            <div className="form-group">
              <label>
                {label('Why is it decorative?')}
                <input type="text" value={value.decorative_reason || ''} onChange={e => onChange({ decorative_reason: e.target.value })} />
              </label>
            </div>
          ) : (
            <>
              <div className="form-group">
                <label>
                  {label('Alt text')}
                  <input
                    type="text"
                    value={alt}
                    aria-describedby={`${id}-alt-count`}
                    onChange={e => onChange({ alt_text: e.target.value })}
                  />
                </label>
                <p className="field-help" id={`${id}-alt-count`}>
                  {alt.length} of {ALT_SOFT_LIMIT} characters. One sentence that says what the visual shows and why it matters.
                </p>
                {alt.length > ALT_SOFT_LIMIT && (
                  <p className="field-help" role="status">
                    This alt text is {alt.length} characters. {ALT_SOFT_LIMIT} or fewer reads best. You can still save it.
                  </p>
                )}
              </div>
              <div className="form-group">
                <label>
                  {label('Long description')} <span className="label-optional">(optional, for diagrams and comparisons)</span>
                  <GrowTextarea value={value.long_description || ''} onChange={e => onChange({ long_description: e.target.value })} />
                </label>
              </div>
              <div className="lesson-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={draft} disabled={busy || drafting}>
                  {drafting ? 'Drafting...' : `Generate ${scope ? scope.toLowerCase() + ' ' : ''}alt text`}
                </button>
              </div>
              {drafted && (
                <p className="field-help" role="status">
                  Draft from Byte. Review and edit it, then save. It is not saved yet.
                </p>
              )}
              {error && <p className="status-message error" role="alert">{error}</p>}
            </>
          )}
        </fieldset>
      )}
    </>
  )
}

// What the lesson page shows. The text alternative is what a learner gets;
// the brief stays for the author.
export function VisualDisplay({ item }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  if (!item.visual) return null

  if (item.decorative) {
    return (
      <p className="field-help">
        Decorative visual, left out for screen readers
        {item.decorative_reason ? `: ${item.decorative_reason}` : ''}. Brief for the author: {item.visual}
      </p>
    )
  }

  if (!item.alt_text) {
    return (
      <div className="lesson-visual">
        <div className="lesson-label">Visual</div>
        <p>{item.visual}</p>
        <p className="field-help">No alt text yet. Edit this block to add it.</p>
      </div>
    )
  }

  return (
    <div className="lesson-visual">
      <div className="lesson-label">Visual</div>
      <p>{item.alt_text}</p>
      {item.long_description && (
        <>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            aria-expanded={open}
            aria-controls={`${id}-long`}
            onClick={() => setOpen(o => !o)}
          >
            Describe this visual
          </button>
          <div id={`${id}-long`} hidden={!open} className="lesson-body">
            <Paragraphs text={item.long_description} />
          </div>
        </>
      )}
      <p className="field-help">Brief for the author (not shown to learners): {item.visual}</p>
    </div>
  )
}
