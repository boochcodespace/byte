// server.js — the Express backend for Byte
// Express is a minimal Node.js web framework that makes it easy to
// define API routes (endpoints the frontend can call with fetch()).

const express = require('express')
const cors = require('cors')

// Route handlers — each file groups related API endpoints together
const settingsRoutes = require('./routes/settings')
const sourcesRoutes = require('./routes/sources')
const artifactsRoutes = require('./routes/artifacts')

const app = express()
const PORT = 3001

// CORS lets the frontend (running on port 5173) call this backend (port 3001).
// Without this the browser would block the request as a security measure.
app.use(cors({ origin: 'http://localhost:5173' }))

// Parse JSON bodies so we can read req.body in our route handlers
app.use(express.json())

// Mount routes: all settings endpoints live at /api/settings, etc.
app.use('/api/settings', settingsRoutes)
app.use('/api/sources', sourcesRoutes)
app.use('/api/artifacts', artifactsRoutes)

// Simple health check — useful to confirm the backend is up
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Byte backend is running' })
})

app.listen(PORT, () => {
  console.log(`Byte backend running at http://localhost:${PORT}`)
})
