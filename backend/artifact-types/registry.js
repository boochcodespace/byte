// artifact-types/registry.js
//
// Maps artifact-type keys (the strings that arrive on POST bodies and
// get stamped into artifact.json) to the module that implements them.
// This is the ONLY file routes/artifacts.js needs to import from
// artifact-types/ — everything else reaches Claude through modules
// looked up here.
//
// When adding a new type:
//   1. Create backend/artifact-types/<type-key>/ with prompt-template,
//      schema.json, and index.js (same shape as flip-card-deck).
//   2. Register the module below.
//   3. Add a matching entry to the frontend renderer registry at
//      frontend/src/artifact-renderers/registry.js.
// That is the entire surface area for adding a type.

const flipCardDeck = require('./flip-card-deck')

const TYPES = {
  [flipCardDeck.type]: flipCardDeck,
}

function getTypeModule(typeKey) {
  return TYPES[typeKey] || null
}

function listSupportedTypes() {
  return Object.keys(TYPES)
}

module.exports = { getTypeModule, listSupportedTypes }
