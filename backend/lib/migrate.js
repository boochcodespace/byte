// lib/migrate.js — one-time idempotent migration from flat ~/Byte/sources/ to
// ~/Byte/projects/default/sources/ when upgrading from pre-Projects versions.
// Called at server startup; returns immediately if already migrated.

const fs = require('fs')
const path = require('path')
const os = require('os')

const BYTE_DIR = path.join(os.homedir(), 'Byte')
const OLD_SOURCES_DIR = path.join(BYTE_DIR, 'sources')
const PROJECTS_DIR = path.join(BYTE_DIR, 'projects')

function runMigrationIfNeeded() {
  // Already migrated or fresh install — nothing to do
  if (fs.existsSync(PROJECTS_DIR)) return
  if (!fs.existsSync(OLD_SOURCES_DIR)) return

  const timestamp = Date.now()
  const defaultSlug = 'default'
  const defaultDir = path.join(PROJECTS_DIR, defaultSlug)
  const defaultSourcesDir = path.join(defaultDir, 'sources')

  fs.mkdirSync(defaultSourcesDir, { recursive: true })

  fs.writeFileSync(
    path.join(defaultDir, 'project.json'),
    JSON.stringify({
      id: defaultSlug,
      slug: defaultSlug,
      title: 'Default Project',
      description: 'Migrated from a previous version of Byte.',
      styleGuide: '',
      targetAudience: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, null, 2)
  )

  // Move each source subfolder into the new location
  for (const entry of fs.readdirSync(OLD_SOURCES_DIR)) {
    const src = path.join(OLD_SOURCES_DIR, entry)
    if (fs.statSync(src).isDirectory()) {
      fs.renameSync(src, path.join(defaultSourcesDir, entry))
    }
  }

  fs.writeFileSync(
    path.join(BYTE_DIR, 'migration-log.txt'),
    [
      `Migration completed: ${new Date().toISOString()}`,
      `Moved ~/Byte/sources → ~/Byte/projects/default/sources/`,
      `Original folder backed up as: sources.backup-${timestamp}/`,
    ].join('\n') + '\n'
  )

  fs.renameSync(OLD_SOURCES_DIR, path.join(BYTE_DIR, `sources.backup-${timestamp}`))
  console.log('[migrate] Migrated ~/Byte/sources → ~/Byte/projects/default/sources')
}

module.exports = { runMigrationIfNeeded }
