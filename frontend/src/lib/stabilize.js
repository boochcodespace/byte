// frontend/src/lib/stabilize.js
//
// Keeps artifact objects STABLE across lesson refreshes.
//
// The artifact renderers (scenario, knowledge check, flip deck) reset to
// their first screen whenever the `artifact` prop changes identity. The
// lesson page replaces its whole lesson object after every action
// (dismissing a proposal, generating another artifact, updating the time
// meter), and each response carries freshly parsed artifact JSON. If those
// fresh objects were passed straight down, a learner halfway through a
// knowledge check would be sent back to question 1 every time anything
// else on the page changed.
//
// stabilizeArtifacts reuses the PREVIOUS object for any artifact whose
// content has not changed, so identity only changes when the artifact
// really did (for example, edited in the artifact editor).

export function stabilizeArtifacts(prev, next) {
  const out = {}
  for (const key of Object.keys(next || {})) {
    const before = prev ? prev[key] : undefined
    const after = next[key]
    out[key] = before && after && JSON.stringify(before) === JSON.stringify(after)
      ? before
      : after
  }
  return out
}
