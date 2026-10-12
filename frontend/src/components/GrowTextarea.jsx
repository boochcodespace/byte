import { forwardRef, useRef, useLayoutEffect, useImperativeHandle } from 'react'

// A text area that grows with its content (long visual notes, artifact text).
// Accepts a ref, so a parent can move focus into it.
const GrowTextarea = forwardRef(function GrowTextarea({ value, onChange, disabled, rows = 2, ...rest }, forwarded) {
  const ref = useRef(null)
  useImperativeHandle(forwarded, () => ref.current)
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
})

export default GrowTextarea
