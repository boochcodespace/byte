import { forwardRef, useRef, useLayoutEffect, useEffect, useImperativeHandle } from 'react'

// A text area that grows with its content (long visual notes, artifact text).
// Accepts a ref, so a parent can move focus into it.
const GrowTextarea = forwardRef(function GrowTextarea({ value, onChange, disabled, rows = 2, ...rest }, forwarded) {
  const ref = useRef(null)
  useImperativeHandle(forwarded, () => ref.current)
  // Height = content + the border, which scrollHeight leaves out. Without the
  // border the last line is clipped.
  const fit = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`
  }
  useLayoutEffect(fit, [value])
  // Text re-wraps when the box gets wider or narrower, so measure again then.
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    let width = el.offsetWidth
    const ro = new ResizeObserver(() => { if (el.offsetWidth !== width) { width = el.offsetWidth; fit() } })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
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
