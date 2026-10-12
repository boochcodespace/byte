// backend/lib/project-artifacts.js
//
// Read-only list of every artifact in a project, gathered across all of
// its sources. Storage stays per source (nothing is moved or copied); this
// only walks the folders so a lesson can offer "pick an existing artifact".
//
// Each entry identifies an artifact by { source, folder }, the same pair a
// lesson block stores as its reference.

const fs = require('fs')
const path = require('path')
const { isSafeSegment, projectDir } = require('../lessons/store')

// Folder names end in the creation time in milliseconds
// (e.g. knowledge-check-1718000000000). Older folders ("flip-cards-<ts>")
// follow the same pattern. Anything else falls back to the file's mtime.
function createdAtOf(folder, file) {
  const m = folder.match(/-(\d{10,})$/)
  if (m) return Number(m[1])
  try {
    return fs.statSync(file).mtimeMs
  } catch {
    return 0
  }
}

function firstLine(markdown) {
  const line = markdown.split('\n').find(l => l.trim()) || 'Untitled'
  return line.replace(/^#+\s*/, '').trim()
}

// Newest first. `type` optionally filters (artifacts saved before types
// existed have no type field and count as flip-card-deck).
function listProjectArtifacts(projectSlug, { type } = {}) {
  const sourcesDir = path.join(projectDir(projectSlug), 'sources')
  if (!fs.existsSync(sourcesDir)) return []

  const out = []
  for (const source of fs.readdirSync(sourcesDir)) {
    if (!isSafeSegment(source)) continue
    const sourceDir = path.join(sourcesDir, source)
    if (!fs.statSync(sourceDir).isDirectory()) continue

    const artifactsDir = path.join(sourceDir, 'artifacts')
    if (!fs.existsSync(artifactsDir)) continue

    let sourceTitle = source
    const mdPath = path.join(sourceDir, 'source.md')
    if (fs.existsSync(mdPath)) sourceTitle = firstLine(fs.readFileSync(mdPath, 'utf-8'))

    for (const folder of fs.readdirSync(artifactsDir)) {
      if (!isSafeSegment(folder)) continue
      const file = path.join(artifactsDir, folder, 'artifact.json')
      if (!fs.existsSync(file)) continue
      let artifact
      try {
        artifact = JSON.parse(fs.readFileSync(file, 'utf-8'))
      } catch {
        continue // an unreadable file is skipped, never deleted
      }
      const artifactType = artifact.type || 'flip-card-deck'
      if (type && artifactType !== type) continue
      out.push({
        source,
        sourceTitle,
        folder,
        type: artifactType,
        title: artifact.learning_objective || '',
        createdAt: createdAtOf(folder, file),
        edited: !!artifact.edited,
      })
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

module.exports = { listProjectArtifacts }
