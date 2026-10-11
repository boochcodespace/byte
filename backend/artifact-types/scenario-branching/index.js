// artifact-types/scenario-branching/index.js
//
// Scenario Branching artifact type: a short decision tree where the
// learner commits to a choice before any feedback is shown, then sees
// the consequence and moves on. Exports the same module contract as
// every artifact type (see flip-card-deck/index.js for the full list).
//
// Type-specific note: a branching scenario carries several nodes with
// feedback on every choice, so its JSON is larger than a flip deck's.
// The per-type generate() wrapper raises the token budget so the
// response is not cut off mid-JSON, which is the reason this wrapper
// exists per type instead of being shared.

const { promptTemplate } = require('./prompt-template')
const schema = require('./schema.json')
const { runGeneration } = require('../shared/generate')

const TYPE = 'scenario-branching'
const MAX_TOKENS = 6000

async function generate(args) {
  return runGeneration({
    ...args,
    typeModule: module.exports,
    modelOverrides: { maxTokens: MAX_TOKENS },
  })
}

// Refinement lives in Phase 2B-2. Stubbed so the module contract is
// complete from day one.
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
