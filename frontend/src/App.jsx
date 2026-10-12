import { useRef, useState, useEffect } from 'react'
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import ProjectsPage from './pages/ProjectsPage'
import ProjectDetail from './pages/ProjectDetail'
import AddSource from './pages/AddSource'
import SourceDetail from './pages/SourceDetail'
import LessonNew from './pages/LessonNew'
import LessonDetail from './pages/LessonDetail'
import LessonPreview from './pages/LessonPreview'
import Settings from './pages/Settings'

// App is the top-level shell: persistent header + page routing.
// Routes maps URL paths to page components.
function App() {
  const location = useLocation()
  const mainRef = useRef(null)
  // The learner preview shows only what a learner sees, so it has no
  // authoring header.
  const isPreview = location.pathname.endsWith('/preview')

  // Route changes (WCAG 2.4.3, 4.1.3): when the user moves to another page,
  // focus goes to that page's h1 (or the main region) and a polite live
  // region says which page it is. The page sets its own title once its data
  // has loaded, so wait for a real title and an h1, up to three seconds.
  const [routeMessage, setRouteMessage] = useState('')
  const lastPath = useRef(location.pathname)   // compared by value so React's dev double-run cannot trigger it
  useEffect(() => {
    if (lastPath.current === location.pathname) return
    lastPath.current = location.pathname
    setRouteMessage('')
    let tries = 0
    const timer = setInterval(() => {
      tries += 1
      const h1 = document.querySelector('main h1')
      if ((h1 && document.title !== 'Byte') || tries > 30) {
        clearInterval(timer)
        const target = h1 || mainRef.current
        if (target) { target.setAttribute('tabindex', '-1'); target.focus() }
        setRouteMessage(`Now on ${document.title.replace(/ — Byte$/, '')}.`)
      }
    }, 100)
    return () => clearInterval(timer)
  }, [location.pathname])

  // The skip link: move focus to <main>. Done by hand so the router does
  // not treat the hash as a page change.
  function skipToMain(e) {
    e.preventDefault()
    mainRef.current?.focus()
    mainRef.current?.scrollIntoView()
  }

  return (
    <div className="app">
      <div className="sr-only" role="status" aria-live="polite">{routeMessage}</div>
      <a href="#main" className="skip-link" onClick={skipToMain}>Skip to main content</a>
      {!isPreview && (
      <header className="app-header">
        <Link to="/" className="app-logo">Byte</Link>
        <nav aria-label="Main">
          <Link
            to="/settings"
            className={location.pathname === '/settings' ? 'active' : ''}
          >
            Settings
          </Link>
        </nav>
      </header>
      )}

      <main className="app-main" id="main" tabIndex={-1} ref={mainRef}>
        <Routes>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/projects/:projectSlug" element={<ProjectDetail />} />
          <Route path="/projects/:projectSlug/sources/new" element={<AddSource />} />
          <Route path="/projects/:projectSlug/sources/:slug" element={<SourceDetail />} />
          <Route path="/projects/:projectSlug/lessons/new" element={<LessonNew />} />
          <Route path="/projects/:projectSlug/lessons/:lessonId" element={<LessonDetail />} />
          <Route path="/projects/:projectSlug/lessons/:lessonId/preview" element={<LessonPreview />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
