import { Routes, Route, Link, useLocation } from 'react-router-dom'
import ProjectsPage from './pages/ProjectsPage'
import ProjectDetail from './pages/ProjectDetail'
import AddSource from './pages/AddSource'
import SourceDetail from './pages/SourceDetail'
import LessonNew from './pages/LessonNew'
import LessonDetail from './pages/LessonDetail'
import Settings from './pages/Settings'

// App is the top-level shell: persistent header + page routing.
// Routes maps URL paths to page components.
function App() {
  const location = useLocation()

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="app-logo">Byte</Link>
        <nav>
          <Link
            to="/settings"
            className={location.pathname === '/settings' ? 'active' : ''}
          >
            Settings
          </Link>
        </nav>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/projects/:projectSlug" element={<ProjectDetail />} />
          <Route path="/projects/:projectSlug/sources/new" element={<AddSource />} />
          <Route path="/projects/:projectSlug/sources/:slug" element={<SourceDetail />} />
          <Route path="/projects/:projectSlug/lessons/new" element={<LessonNew />} />
          <Route path="/projects/:projectSlug/lessons/:lessonId" element={<LessonDetail />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
