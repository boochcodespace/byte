import { useRef, useLayoutEffect } from 'react'

// A text area that grows with its content (for long visual notes).
function GrowTextarea({ value, onChange, disabled, rows = 2, ...rest }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={rows}
      className="grow-textarea"
      value={value}
      onChange={onChange}
      disabled={disabled}
      {...rest}
    />
  )
}

export default GrowTextarea
