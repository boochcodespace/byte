// artifact-types/flip-card-deck/prompt-template.js
//
// Builds the user message Claude sees when asked to generate a flip
// card deck. Common steering / context / objective blocks come from
// the shared buildPromptContext() helper; this file owns the flip-
// card-specific framing, requirements, and JSON response schema
// preamble.

function promptTemplate(ctx /* , extras — flip-card-deck has none today */) {
  const { sourceContent, steeringBlock, learnerContextBlock, objectivesBlock } = ctx

  return `Generate a flip card deck from the following source content. This is \
SECONDARY content creation: treat the source as reference material to \
faithfully distill, not as inspiration for invention.

${steeringBlock}

${learnerContextBlock}

═══ LEARNING OBJECTIVES ═══
${objectivesBlock}

═══ SOURCE CONTENT (reference material) ═══
${sourceContent}

═══ REQUIREMENTS ═══

DECK SIZING
- 6 to 10 cards when source is rich
- 4 to 6 cards when source is thin (do not pad)
- One learning objective for the full deck, stated at the top
- Every card is atomic: one fact, one decision point, one insight
- Total completion time under 5 minutes

CARD CONSTRUCTION
- Front: a question, key term, or decision point (maximum 20 words)
- Back: the answer or insight, stripped to its core (maximum \
25 words, one sentence)
- Never compound questions on the front
- Every front makes the learner answer, predict, or decide before the \
back is revealed
- Every card makes sense on its own days later, with no reference to \
other cards
- Reject any card whose front could be answered without actually \
engaging with the source content

CARD TYPES
- One HOOK card opens the deck: the front names the job task and the \
payoff in the learner's terms, then poses a decision or prediction \
grounded in the source for the learner to attempt before the reveal
- CONTENT cards form the body: each covering one atomic concept from \
the source
- One APPLY card closes the deck: a specific action the learner can \
take within 24 hours, with a named trigger ("Next time X happens, \
do Y")

BLOOM ALIGNMENT
Flip cards naturally fit Remember and Understand levels. If the \
learning objective requires Apply, Analyze, or Evaluate, flip cards \
may not be the right format; generate what you can but note in \
spaced_repetition_notes that a Knowledge Check or Scenario would \
serve the objective better.

VOICE
- Second person, present tense, active voice
- Conversational but disciplined
- Front is the learner's question; back is the expert's answer
- No filler phrases, no throat-clearing, no hedging

FEW-SHOT EXAMPLE

Here is one exemplar card showing the structural detail expected:

  INPUT: "DHCP lease" for junior IT support
  OUTPUT: {
    "type": "content",
    "front": "What does a DHCP server hand out, and for how long by default?",
    "back": "An IP address (plus subnet mask, gateway, DNS) leased for 24 hours by default on most consumer routers."
  }

Note the structural details: specific default values (24 hours), \
parenthetical enrichment (plus subnet mask...), concrete scoping \
(consumer routers). Not "leased for a period of time." Not "various \
networking parameters." This level of specific, named detail is what \
separates professional flip cards from generic AI output.

Respond in this JSON schema:
{
  "learning_objective": "string (states one Bloom-verb objective)",
  "estimated_minutes": number,
  "visual_anchor_description": "string (describe one diagram or \
annotated screenshot that carries meaning for this deck; no decorative \
imagery)",
  "cards": [
    {
      "type": "hook | content | apply",
      "front": "string",
      "back": "string"
    }
  ],
  "spaced_repetition_notes": "string (which cards would benefit from \
resurfacing as a different artifact type later; any gaps or \
ambiguities in the source)"
}`
}

module.exports = { promptTemplate }
