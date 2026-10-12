// backend/lessons/sources.js
//
// Loads the project sources a lesson draws on and joins them into the one
// block of reference text the prompts receive. There is no summarizing
// step, so the total is capped: past the cap the user is asked to pick
// fewer or shorter sources instead of silently losing text.

const fs = require('fs')
const path = require('path')
const { isSafeSegment, sourceDirPath } = require('./store')
const { validation, notFound } = require('./errors')

const MAX_SOURCE_CHARS = 40000

function extractTitle(content) {
  const firstLine = content.split('\n').find(l => l.trim()) || 'Untitled'
  return firstLine.replace(/^#+\s*/, '').trim()
}

function readSource(projectSlug, slug) {
  if (!isSafeSegment(projectSlug) || !isSafeSegment(slug)) return null
  const dir = sourceDirPath(projectSlug, slug)
  if (!fs.existsSync(dir)) return null
  const mdPath = path.join(dir, 'source.md')
  const content = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf-8') : ''
  let context = {}
  try {
    const ctxPath = path.join(dir, 'context.json')
    if (fs.existsSync(ctxPath)) context = JSON.parse(fs.readFileSync(ctxPath, 'utf-8'))
  } catch {
    context = {}
  }
  return { slug, title: extractTitle(content), content, context }
}

// Returns { sources, text, totalChars }. Throws a friendly not-found for
// any source that is missing, so a lesson never generates from a subset.
function loadSources(projectSlug, slugs) {
  const sources = slugs.map(slug => {
    const source = readSource(projectSlug, slug)
    if (!source) throw notFound(`The source "${slug}" was not found in this project.`)
    return source
  })
  const totalChars = sources.reduce((sum, s) => sum + s.content.length, 0)
  const text = sources
    .map(s => `=== SOURCE: ${s.title} (id: ${s.slug}) ===\n${s.content.trim()}`)
    .join('\n\n')
  return { sources, text, totalChars }
}

function assertWithinCap(totalChars) {
  if (totalChars > MAX_SOURCE_CHARS) {
    throw validation(
      `Your selected sources add up to about ${totalChars.toLocaleString('en-US')} characters, ` +
      `and a lesson can use up to ${MAX_SOURCE_CHARS.toLocaleString('en-US')}. ` +
      'Pick fewer sources, or shorter ones.'
    )
  }
}

module.exports = { MAX_SOURCE_CHARS, readSource, loadSources, assertWithinCap }
