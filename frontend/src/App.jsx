import { Routes, Route, Link, useLocation } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Settings from './pages/Settings'
import SourceDetail from './pages/SourceDetail'

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
          <Route path="/" element={<Dashboard />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/source/:slug" element={<SourceDetail />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
