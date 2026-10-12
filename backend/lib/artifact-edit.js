// backend/lib/artifact-edit.js
//
// Editing a saved artifact's TEXT in place (D2). Version 1 changes words only:
// no cards, options, or decision points are added or removed, so every edit has
// the same shape as the file it replaces. Everything else in the file (ids,
// quality labels, links between nodes, spaced-repetition notes) is kept as is.
//
//   readEditable   the artifact, what is wrong with it (needs a key), and
//                  which lessons use it
//   saveEdits      merge an edit, validate it against the type's schema, set
//                  edited when something really changed, write the file
//   copyArtifact   a copy in the same source folder (keeps edited)
//   usageOf        the lessons that point at an artifact
//
// A real change sets `edited: true` on the artifact. Saving the same words
// again changes nothing. An artifact is shared by every lesson that points at
// it, so an edit shows up in all of them; the routes warn about that.

const fs = require('fs')
const Ajv = require('ajv')
const store = require('../lessons/store')
const { LessonError, notFound, validation } = require('../lessons/errors')

const SCHEMAS = {
  'flip-card-deck': require('../artifact-types/flip-card-deck/schema.json'),
  'knowledge-check': require('../artifact-types/knowledge-check/schema.json'),
  'scenario-branching': require('../artifact-types/scenario-branching/schema.json'),
}
const ajv = new Ajv({ allErrors: true, strict: false })
const validators = {}
const validatorFor = type => validators[type] || (validators[type] = ajv.compile(SCHEMAS[type]))

// Safety caps, far above normal use. They are not writing guidance.
const CAPS = { setup: 2000, apply_today: 1000, scenario: 3000, stem: 2000, option: 1000, rationale: 3000 }

const str = v => (typeof v === 'string' ? v.trim() : '')
const typeOf = artifact => artifact.type || 'flip-card-deck'
const LETTERS = 'ABCDEFGH'

// ── knowledge check ─────────────────────────────────────────────────────

// Items that do not have exactly one option marked as the key. Older files
// can have none or several; they still render, but they are flagged and
// cannot be saved until fixed.
function needsKey(artifact) {
  if (typeOf(artifact) !== 'knowledge-check') return []
  return (artifact.items || [])
    .map((it, i) => ({ item: i, keys: (it.options || []).filter(o => o.correct === true).length }))
    .filter(x => x.keys !== 1)
}

function keyMessage(problems) {
  const first = problems[0]
  const what = first.keys === 0 ? 'has no option marked as the key' : `has ${first.keys} options marked as the key`
  const more = problems.length > 1 ? ` (${problems.length} questions need a key)` : ''
  return `Question ${first.item + 1} ${what}. Mark exactly one option as the key${more}.`
}

function mergeKnowledgeCheck(current, edits) {
  const out = JSON.parse(JSON.stringify(current))
  const text = (value, label, cap, { required }) => {
    const v = str(value)
    if (required && !v) throw validation(`${label} cannot be empty.`)
    if (v.length > cap) throw validation(`${label} can be up to ${cap.toLocaleString('en-US')} characters.`)
    return v
  }
  if (edits.setup !== undefined) out.setup = text(edits.setup, 'The task setup', CAPS.setup, { required: true })
  if (edits.apply_today !== undefined) out.apply_today = text(edits.apply_today, 'The apply-today line', CAPS.apply_today, { required: true })

  if (edits.items !== undefined) {
    if (!Array.isArray(edits.items) || edits.items.length !== current.items.length) {
      throw validation('You can edit the words of each question, but not add or remove questions yet.')
    }
    edits.items.forEach((e, i) => {
      const cur = out.items[i]
      const q = `Question ${i + 1}`
      if (e.stem !== undefined) cur.stem = text(e.stem, `${q}: the question`, CAPS.stem, { required: true })
      if (e.scenario !== undefined && cur.scenario !== undefined) {
        cur.scenario = text(e.scenario, `${q}: the scenario`, CAPS.scenario, { required: false })
        if (!cur.scenario) delete cur.scenario
      }
      if (e.options !== undefined) {
        if (!Array.isArray(e.options) || e.options.length !== cur.options.length) {
          throw validation('You can edit the words of each option, but not add or remove options yet.')
        }
        e.options.forEach((eo, j) => {
          const o = cur.options[j]
          const where = `${q}, option ${LETTERS[j]}`
          if (eo.text !== undefined) o.text = text(eo.text, `${where}: the answer text`, CAPS.option, { required: true })
          if (eo.rationale !== undefined) o.rationale = text(eo.rationale, `${where}: the explanation`, CAPS.rationale, { required: true })
          if (eo.correct !== undefined) {
            if (typeof eo.correct !== 'boolean') throw validation(`${where}: the key must be yes or no.`)
            o.correct = eo.correct
          }
        })
      }
    })
  }
  return out
}

// ── dispatch ────────────────────────────────────────────────────────────

const MERGERS = {
  'knowledge-check': mergeKnowledgeCheck,
}

// The words that count as an edit: everything except bookkeeping.
const BOOKKEEPING = ['edited', 'edited_at', 'copied_from', 'folder']
function content(artifact) {
  const copy = { ...artifact }
  for (const k of BOOKKEEPING) delete copy[k]
  return JSON.stringify(copy)
}

function requireArtifact(projectSlug, source, folder) {
  if (![projectSlug, source, folder].every(store.isSafeSegment)) throw notFound('That artifact was not found.')
  const artifact = store.readArtifact(projectSlug, source, folder)
  if (!artifact) throw notFound('That artifact was not found.')
  return artifact
}

// Which lessons point at this artifact.
function usageOf(projectSlug, source, folder) {
  const out = []
  for (const lesson of store.listLessons(projectSlug)) {
    for (const b of lesson.blocks || []) {
      if (b.kind === 'artifact' && b.ref && b.ref.source === source && b.ref.artifact === folder) {
        out.push({ lesson_id: lesson.id, title: lesson.title, block_id: b.id })
      }
    }
  }
  return out
}

function readEditable(projectSlug, source, folder) {
  const artifact = requireArtifact(projectSlug, source, folder)
  return {
    artifact: { folder, ...artifact },
    type: typeOf(artifact),
    needs_key: needsKey(artifact),
    usage: usageOf(projectSlug, source, folder),
    editable: !!MERGERS[typeOf(artifact)],
  }
}

function saveEdits(projectSlug, source, folder, edits) {
  const current = requireArtifact(projectSlug, source, folder)
  const type = typeOf(current)
  const merge = MERGERS[type]
  if (!merge) throw validation('Editing this kind of artifact is not available yet.')
  if (!edits || typeof edits !== 'object') throw validation('Send the edited words.')

  const merged = merge(current, edits)

  // The key rule comes first so the message is plain, not a schema error.
  const problems = needsKey(merged)
  if (problems.length) throw validation(keyMessage(problems))

  const valid = validatorFor(type)(merged)
  if (!valid) {
    const detail = (validatorFor(type).errors || []).slice(0, 2).map(e => `${e.instancePath || 'the artifact'} ${e.message}`).join('; ')
    throw validation(`Those edits do not fit this ${type.replace('-', ' ')}: ${detail}.`)
  }

  const changed = content(merged) !== content(current)
  if (!changed) return { artifact: { folder, ...current }, changed: false }

  merged.edited = true
  merged.edited_at = new Date().toISOString()
  store.writeArtifact(projectSlug, source, folder, merged)
  return { artifact: { folder, ...merged }, changed: true }
}

// A copy in the same source folder, with a new folder name. It keeps
// `edited`, and records where it came from.
function copyArtifact(projectSlug, source, folder) {
  const current = requireArtifact(projectSlug, source, folder)
  const prefix = folder.replace(/-\d+$/, '') || typeOf(current)
  let stamp = Date.now()
  let next = `${prefix}-${stamp}`
  while (fs.existsSync(store.artifactDirPath(projectSlug, source, next))) next = `${prefix}-${++stamp}`
  fs.cpSync(store.artifactDirPath(projectSlug, source, folder), store.artifactDirPath(projectSlug, source, next), { recursive: true })
  const copy = { ...current, copied_from: { source, artifact: folder } }
  store.writeArtifact(projectSlug, source, next, copy)
  return { source, artifact: next }
}

module.exports = { readEditable, saveEdits, copyArtifact, usageOf, needsKey, typeOf, LessonError }
