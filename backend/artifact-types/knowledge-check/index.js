// artifact-types/knowledge-check/index.js
//
// Knowledge Check artifact type: a short set of single-best-answer
// multiple-choice questions. The learner commits to an answer before
// any reasoning is shown. Item rules come from the cert-item-writer
// skill (stem style, option count, distractor quality), adapted to
// Byte's principles. Exports the same module contract as every
// artifact type (see flip-card-deck/index.js for the full list).
//
// Type-specific note: every option carries its own rationale, so the
// JSON is larger than a flip deck's. The per-type generate() wrapper
// raises the token budget so the response is not cut off mid-JSON.

const { promptTemplate } = require('./prompt-template')
const schema = require('./schema.json')
const { runGeneration } = require('../shared/generate')

const TYPE = 'knowledge-check'
const MAX_TOKENS = 5000

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
