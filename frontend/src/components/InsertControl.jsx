import { useState, useRef, useEffect } from 'react'

// InsertControl
//
// A small "Insert here" control that sits between lesson blocks. It only
// CHOOSES what to insert; the page decides what each choice does (open a
// context panel, a picker, an editor) and where the result goes. That keeps
// it reusable: the lesson editor can later add text block kinds by adding an
// option, with no change to this component.
//
// Steps: press the button, pick a kind, pick how (a mode), and the choice is
// reported through onSelect. Cancel and Back are always available.
//
// Props:
//   options   [{ id, label, modes: [{ id, label }] }]
//   onSelect  ({ option, mode }) => void   called when a mode is chosen
//   disabled  lock the control (another action is running)
//   label     what the control follows, so every "Insert here" has a unique name

function InsertControl({ options, onSelect, disabled, label, focusKey }) {
  const [open, setOpen] = useState(false)
  const [option, setOption] = useState(null)
  const openBtn = useRef(null)
  const cameFromCancel = useRef(false)
  const firstOption = useRef(null)
  // Return focus to "Insert here" after Cancel; move focus to the first
  // choice when the menu opens.
  useEffect(() => {
    if (!open && cameFromCancel.current) { cameFromCancel.current = false; openBtn.current?.focus() }
    if (open && !option) firstOption.current?.focus()
  }, [open, option])

  function reset(fromCancel = false) {
    cameFromCancel.current = fromCancel
    setOpen(false)
    setOption(null)
  }

  if (!open) {
    return (
      <div className="insert-control">
        <button
          type="button"
          ref={openBtn}
          data-focus-key={focusKey}
          className="btn btn-secondary btn-sm"
          aria-expanded="false"
          aria-label={label ? `Insert here, after ${label}` : undefined}
          onClick={() => setOpen(true)}
          disabled={disabled}
        >
          + Insert here
        </button>
      </div>
    )
  }

  if (!option) {
    return (
      <div className="insert-control" role="group" aria-label="Choose what to insert">
        <span>Insert:</span>
        {options.map((o, i) => (
          <button key={o.id} ref={i === 0 ? firstOption : undefined} type="button" className="btn btn-secondary btn-sm" onClick={() => setOption(o)} disabled={disabled}>
            {o.label}
          </button>
        ))}
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => reset(true)}>
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className="insert-control" role="group" aria-label={`How to insert ${option.label}`}>
      <span>{option.label}:</span>
      {option.modes.map(m => (
        <button
          key={m.id}
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => { onSelect({ option, mode: m }); reset() }}
          disabled={disabled}
        >
          {m.label}
        </button>
      ))}
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOption(null)}>
        Back
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => reset(true)}>
        Cancel
      </button>
    </div>
  )
}

export default InsertControl
