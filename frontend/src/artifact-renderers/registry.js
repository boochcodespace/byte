// artifact-renderers/registry.js
//
// Maps artifact.type strings to everything the UI needs to show that
// type: its renderer component, its display label, and its icon. The
// source detail page reads `artifact.type` and looks things up here;
// unknown types (or missing type, as on older artifacts) fall back to
// flip-card-deck, which is the only type that existed before the
// registry pattern.
//
// When adding a new artifact type:
//   1. Create frontend/src/artifact-renderers/<type-key>/Renderer.jsx
//      (plus a sibling Renderer.css if it has styles).
//   2. Import the component below.
//   3. Add an entry to ARTIFACT_TYPES keyed by the same string the
//      backend artifact-type module uses.
// That's the whole surface area on the frontend. The Generate dropdown
// and the artifact list pick the new type up automatically.

import FlipCardDeckRenderer from './flip-card-deck/Renderer'
import ScenarioBranchingRenderer from './scenario-branching/Renderer'

export const DEFAULT_TYPE = 'flip-card-deck'

const ARTIFACT_TYPES = {
  'flip-card-deck': {
    label: 'Flip Card Deck',
    icon: '🃏',
    Renderer: FlipCardDeckRenderer,
  },
  'scenario-branching': {
    label: 'Scenario Branching',
    icon: '🔀',
    Renderer: ScenarioBranchingRenderer,
  },
}

// Options for the Generate dropdown, in registration order.
export const ARTIFACT_TYPE_OPTIONS = Object.entries(ARTIFACT_TYPES).map(
  ([value, { label }]) => ({ value, label })
)

// Old artifacts on disk have no `type` field — they're all flip card
// decks. Return the fallback entry rather than null so the page never
// renders an empty panel for a legitimate artifact.
function getEntry(type) {
  return ARTIFACT_TYPES[type] || ARTIFACT_TYPES[DEFAULT_TYPE]
}

export function getRenderer(type) {
  return getEntry(type).Renderer
}

// { label, icon } for the artifact list.
export function getTypeMeta(type) {
  const { label, icon } = getEntry(type)
  return { label, icon }
}
