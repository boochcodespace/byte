import { useRef } from 'react'
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

  // The skip link: move focus to <main>. Done by hand so the router does
  // not treat the hash as a page change.
  function skipToMain(e) {
    e.preventDefault()
    mainRef.current?.focus()
    mainRef.current?.scrollIntoView()
  }

  return (
    <div className="app">
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
