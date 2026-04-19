// server.js — the Express backend for Byte
// Express is a minimal Node.js web framework that makes it easy to
// define API routes (endpoints the frontend can call with fetch()).

const express = require('express')
const cors = require('cors')

const { runMigrationIfNeeded } = require('./lib/migrate')

// Route handlers — each file groups related API endpoints together.
// Sources and artifacts are mounted as nested routers inside projects.
const settingsRoutes = require('./routes/settings')
const projectsRoutes = require('./routes/projects')

// Run the one-time migration before any requests are accepted.
// Idempotent: no-op once ~/Byte/projects/ exists.
runMigrationIfNeeded()

const app = express()
const PORT = 3001

// CORS lets the frontend (running on port 5173) call this backend (port 3001).
app.use(cors({ origin: 'http://localhost:5173' }))

// Parse JSON bodies so we can read req.body in our route handlers
app.use(express.json())

// Mount routes:
//   /api/settings
//   /api/projects                                          (list/create projects)
//   /api/projects/:projectSlug                             (read/update/delete project)
//   /api/projects/:projectSlug/sources                     (list/create sources)
//   /api/projects/:projectSlug/sources/upload              (file upload)
//   /api/projects/:projectSlug/sources/:sourceSlug         (read/update/delete source)
//   /api/projects/:projectSlug/sources/:sourceSlug/artifacts/generate
app.use('/api/settings', settingsRoutes)
app.use('/api/projects', projectsRoutes)

// Simple health check — useful to confirm the backend is up
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Byte backend is running' })
})

app.listen(PORT, () => {
  console.log(`Byte backend running at http://localhost:${PORT}`)
})
