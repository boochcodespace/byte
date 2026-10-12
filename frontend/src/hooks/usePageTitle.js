import { useEffect } from 'react'

// Give each page its own document title (WCAG 2.4.2), e.g. "Settings — Byte".
// Pass nothing while the page is still loading and the title stays "Byte".
export function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} — Byte` : 'Byte'
  }, [title])
}
