// backend/lessons/store.js
//
// Disk access for lessons. Layout (storage stays per source for
// artifacts; lessons live at project level):
//
//   ~/Byte/projects/<project>/lessons/<lesson-id>/lesson.json
//   ~/Byte/projects/<project>/sources/<source>/artifacts/<folder>/artifact.json
//
// A lesson block references an artifact by { source, artifact } where
// "artifact" is the artifact's folder name. References are never copies,
// so an edit to the artifact shows in every lesson that uses it.
//
// Every id that arrives from a URL or request body passes through
// isSafeSegment() before it touches a path, so a crafted id such as
// "../../x" cannot escape the project folder.

const fs = require('fs')
const path = require('path')
const os = require('os')
const slugify = require('slugify')

const PROJECTS_DIR = path.join(os.homedir(), 'Byte', 'projects')

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function isSafeSegment(value) {
  return typeof value === 'string' && value.length <= 200 &&
    SAFE_SEGMENT.test(value) && !value.includes('..')
}

function projectDir(projectSlug) {
  return path.join(PROJECTS_DIR, projectSlug)
}

function sourceDirPath(projectSlug, sourceSlug) {
  return path.join(projectDir(projectSlug), 'sources', sourceSlug)
}

function lessonDirPath(projectSlug, lessonId) {
  return path.join(projectDir(projectSlug), 'lessons', lessonId)
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

function readProject(projectSlug) {
  if (!isSafeSegment(projectSlug)) return null
  return readJson(path.join(projectDir(projectSlug), 'project.json'))
}

function readLesson(projectSlug, lessonId) {
  if (!isSafeSegment(projectSlug) || !isSafeSegment(lessonId)) return null
  return readJson(path.join(lessonDirPath(projectSlug, lessonId), 'lesson.json'))
}

function writeLesson(projectSlug, lesson) {
  lesson.updated_at = new Date().toISOString()
  const dir = lessonDirPath(projectSlug, lesson.id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'lesson.json'), JSON.stringify(lesson, null, 2))
  return lesson
}

function listLessons(projectSlug) {
  if (!isSafeSegment(projectSlug)) return []
  const dir = path.join(projectDir(projectSlug), 'lessons')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(name => isSafeSegment(name))
    .map(name => readLesson(projectSlug, name))
    .filter(Boolean)
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
}

function newLessonId(projectSlug, title) {
  let base = slugify(String(title || '').trim(), { lower: true, strict: true }).slice(0, 60)
  if (!base) base = 'lesson'
  let id = base
  if (fs.existsSync(lessonDirPath(projectSlug, id))) id = `${base}-${Date.now()}`
  return id
}

function artifactKey(source, artifact) {
  return `${source}/${artifact}`
}

// Read one artifact by reference. Returns null when the reference is
// unsafe, the source or artifact is gone, or the file cannot be parsed.
// Callers treat null as "no longer available"; nothing is ever deleted
// because a reference stopped resolving.
function readArtifact(projectSlug, source, artifact) {
  if (!isSafeSegment(projectSlug) || !isSafeSegment(source) || !isSafeSegment(artifact)) return null
  return readJson(path.join(sourceDirPath(projectSlug, source), 'artifacts', artifact, 'artifact.json'))
}

// Folder that holds one artifact (artifact.json plus anything saved with it).
function artifactDirPath(projectSlug, source, artifact) {
  return path.join(sourceDirPath(projectSlug, source), 'artifacts', artifact)
}

// Save an artifact in place. The file is written to a temporary name and
// renamed, so a crash never leaves half a file. Callers validate first.
function writeArtifact(projectSlug, source, artifact, data) {
  if (!isSafeSegment(projectSlug) || !isSafeSegment(source) || !isSafeSegment(artifact)) {
    throw new Error('Unsafe artifact reference')
  }
  const file = path.join(artifactDirPath(projectSlug, source, artifact), 'artifact.json')
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
}

module.exports = {
  PROJECTS_DIR,
  artifactDirPath,
  writeArtifact,
  isSafeSegment,
  projectDir,
  sourceDirPath,
  readProject,
  readLesson,
  writeLesson,
  listLessons,
  newLessonId,
  artifactKey,
  readArtifact,
}
