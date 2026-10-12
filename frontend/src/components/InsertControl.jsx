import { useState } from 'react'

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

function InsertControl({ options, onSelect, disabled }) {
  const [open, setOpen] = useState(false)
  const [option, setOption] = useState(null)

  function reset() {
    setOpen(false)
    setOption(null)
  }

  if (!open) {
    return (
      <div className="insert-control">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          aria-expanded="false"
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
        {options.map(o => (
          <button key={o.id} type="button" className="btn btn-secondary btn-sm" onClick={() => setOption(o)} disabled={disabled}>
            {o.label}
          </button>
        ))}
        <button type="button" className="btn btn-secondary btn-sm" onClick={reset}>
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
      <button type="button" className="btn btn-secondary btn-sm" onClick={reset}>
        Cancel
      </button>
    </div>
  )
}

export default InsertControl
