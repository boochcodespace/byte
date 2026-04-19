// artifact-renderers/registry.js
//
// Maps artifact.type strings to renderer components. The source
// detail page reads `artifact.type` and looks the renderer up here;
// unknown types (or missing type, as on older artifacts) fall back to
// flip-card-deck, which is the only type that existed before the
// registry pattern.
//
// When adding a new artifact type:
//   1. Create frontend/src/artifact-renderers/<type-key>/Renderer.jsx
//      (plus a sibling Renderer.css if it has styles).
//   2. Import the component below.
//   3. Register it in the RENDERERS map keyed by the same string the
//      backend artifact-type module uses.
// That's the whole surface area on the frontend.

import FlipCardDeckRenderer from './flip-card-deck/Renderer'

export const DEFAULT_TYPE = 'flip-card-deck'

const RENDERERS = {
  'flip-card-deck': FlipCardDeckRenderer,
}

// Old artifacts on disk have no `type` field — they're all flip card
// decks. Return the fallback renderer rather than null so the page
// never renders an empty panel for a legitimate artifact.
export function getRenderer(type) {
  return RENDERERS[type] || RENDERERS[DEFAULT_TYPE]
}
