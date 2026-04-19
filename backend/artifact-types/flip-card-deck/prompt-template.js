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
- Distill the source. Do not invent content beyond what the source supports.
- If the source is thin, produce a tighter deck (4-6 cards) rather than
  padding with generic content to hit a target count.
- If the source is rich, produce a fuller deck (6-10 cards).
- One learning objective for the full deck. State it at the top.
- Open with a hook card: a decision, stat, or challenge grounded in the
  source material that pulls the learner in before they know the answer.
- Each content card: front is a question, key term, or decision point
  drawn from the source; back is the answer or insight, stripped to its
  core, in the project's voice.
- Final card is an "Apply today" card: one specific action the learner
  can take right now, grounded in the source's actual content.
- Use the source's own frameworks, terminology, and examples. Do not
  substitute your own.
- Suggest one visual anchor for the deck, describing it precisely enough
  that it could be sketched.
- Estimate completion time in minutes.
- If the source is too thin to support the full requirements, produce
  your best distillation and note the gap in spaced_repetition_notes.

Respond in this JSON schema:
{
  "learning_objective": "string",
  "estimated_minutes": number,
  "visual_anchor_description": "string",
  "cards": [
    {
      "type": "hook | content | apply",
      "front": "string",
      "back": "string"
    }
  ],
  "spaced_repetition_notes": "string describing which cards would benefit from resurfacing as a different artifact type later, and flagging any gaps or ambiguities in the source material"
}`
}

module.exports = { promptTemplate }
