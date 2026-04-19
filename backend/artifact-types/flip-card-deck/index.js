// artifact-types/flip-card-deck/index.js
//
// Flip Card Deck artifact type. Exports the module contract every
// artifact type conforms to:
//
//   type         — string key, matches the folder name and the
//                  artifact.type field the frontend registry uses.
//   promptTemplate(ctx, extras) → string
//                  Builds the user message for this type, given the
//                  shared prompt context struct.
//   schema       — JSON Schema object Claude's response is validated
//                  against before the artifact is persisted.
//   generate({ promptContext, extras, sourceDir, apiKey })
//                  Thin wrapper around shared runGeneration; exists
//                  per-type so future types can override model /
//                  token budget without touching shared code.
//   refineWhole  — STUB. Phase 2B-2 implements whole-artifact refinement.
//   refinePiece  — STUB. Phase 2B-2 implements piece-level refinement.
//
// When adding a new artifact type, copy this folder, rename, swap
// in the new type's prompt-template + schema + any type-specific
// extras handling, and register it in ../registry.js.

const { promptTemplate } = require('./prompt-template')
const schema = require('./schema.json')
const { runGeneration } = require('../shared/generate')

const TYPE = 'flip-card-deck'

async function generate(args) {
  return runGeneration({ ...args, typeModule: module.exports })
}

// Refinement lives in Phase 2B-2. Stubbed here so the module contract
// is complete from day one and 2B-2 becomes a fill-in, not a rewrite.
function notImplementedError(label) {
  const err = new Error(`${label} is not yet implemented (Phase 2B-2)`)
  err.code = 'NOT_IMPLEMENTED'
  return err
}
async function refineWhole(/* existing, instruction */) {
  throw notImplementedError('Whole-artifact refinement')
}
async function refinePiece(/* existing, pieceId, instruction */) {
  throw notImplementedError('Piece-level refinement')
}

module.exports = {
  type: TYPE,
  promptTemplate,
  schema,
  generate,
  refineWhole,
  refinePiece,
}
