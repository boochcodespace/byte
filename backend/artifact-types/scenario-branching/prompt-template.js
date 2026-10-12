// artifact-types/scenario-branching/prompt-template.js
//
// Builds the user message Claude sees when asked to generate a
// branching scenario. Common steering / context / objective blocks come
// from the shared buildPromptContext() helper; this file owns the
// scenario-specific structure, decision-design rules, and JSON schema.
//
// Retrieval-first lives in two places: this prompt (no choice may hint
// at the best answer; feedback is written for AFTER the learner
// commits) and the renderer (feedback is not shown until a choice is
// locked in). The renderer also shuffles choice order, so the model is
// told never to refer to choices by position.
//
// Decision count: standalone scenarios run 3 to 5 decisions. The lesson
// generator passes extras.minDecisions / extras.maxDecisions (2 to 3
// inside a lesson). Values are clamped to 2 to 5 so a bad value cannot
// produce an unusable prompt.

const DEFAULT_MIN_DECISIONS = 3
const DEFAULT_MAX_DECISIONS = 5
const FLOOR_DECISIONS = 2
const CEILING_DECISIONS = 5

function clampDecisions(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const n = Number(value)
  if (!Number.isInteger(n)) return fallback
  return Math.min(CEILING_DECISIONS, Math.max(FLOOR_DECISIONS, n))
}

function resolveDecisionRange(extras = {}) {
  const max = clampDecisions(extras.maxDecisions, DEFAULT_MAX_DECISIONS)
  // If only a max is given, never default the min above it
  let min = clampDecisions(extras.minDecisions, Math.min(DEFAULT_MIN_DECISIONS, max))
  if (min > max) min = max
  return { min, max }
}

function promptTemplate(ctx, extras = {}) {
  const { sourceContent, steeringBlock, learnerContextBlock, objectivesBlock } = ctx
  const { min, max } = resolveDecisionRange(extras)

  const decisionText = min === max ? `exactly ${min}` : `${min} to ${max}`
  const nodesMin = min + 2
  const nodesMax = max + 3

  return `Generate a branching scenario from the following source content. This is \
SECONDARY content creation: treat the source as reference material to \
faithfully distill, not as inspiration for invention. Every situation, \
choice, and consequence must trace back to the source.

${steeringBlock}

${learnerContextBlock}

═══ LEARNING OBJECTIVES ═══
${objectivesBlock}

═══ SOURCE CONTENT (reference material) ═══
${sourceContent}

═══ REQUIREMENTS ═══

SIZING
- ${decisionText} decision points on any path from start to ending
- ${nodesMin} to ${nodesMax} nodes in total, including endings (use fewer when \
the source is thin; do not pad)
- 2 or 3 choices per decision node
- Every path reaches an ending node
- Total completion time under 5 minutes
- One learning objective for the whole scenario, stated at the top

STRUCTURE
- "setup": 2 to 3 sentences in second person. First name the job task \
the learner is practicing and the payoff for getting it right, then place \
them in the situation
- "start_node": the id of the first decision node
- Node ids are short strings such as "n1", "n2", "n3"
- A decision node has kind "decision" and a "choices" list. An ending \
node has kind "ending" and no choices; its "situation" text describes \
the outcome of the path
- Every choice's "next" is the id of a node that exists in "nodes". \
Paths may converge on the same node
- Order nodes so that each one is reachable from "start_node"

DECISION DESIGN
- "situation" (maximum 60 words) describes a realistic moment from the \
source, in second person, and ends with the decision the learner must \
make. It is self-contained: a prepared learner can form an answer \
before reading the choices
- Do not name people. Use "you," "your teammate," "your manager," or \
another role, unless the PROJECT STYLE GUIDE explicitly asks for named \
characters
- Choice "text" is maximum 25 words, specific, and grammatically \
consistent with the decision the situation asks for
- The best choice must NOT be obvious. At least one other choice is \
what a capable person under pressure would actually do, and a \
partially prepared learner would find it tempting
- Build every other choice from a realistic mistake, misconception, or \
reasonable-but-costly approach found in the source. Never write filler \
or silly options. Ask: would a partially prepared learner actually pick \
this?
- Match the choices in length, specificity, and tone. The best choice \
must not be the longest or the most detailed. It must not be the only \
choice that sounds careful, patient, or collaborative, and not the only \
one that uses the source's terminology
- Nothing in the situation or the choice text may hint at which choice \
is best. No "obviously," no "recommended," no giveaway wording. Absolute \
words ("always," "never," "only") must appear in every choice or in none
- Choices are mutually exclusive. No "all of the above," no combined \
answers, and no choice that bundles two actions with "and"
- Every decision node has exactly one choice with quality "best". Other \
choices are "acceptable" (defensible but costly) or "weak" (reflects a \
common misconception from the source)
- Vary the position of the best choice from node to node
- Test the objective's Bloom verb. If the objective says Apply, the \
learner applies the source's method to a case. Do not ask recall questions

FEEDBACK
- The learner sees "feedback" only AFTER committing to that choice, so \
write it as a response to a decision already made
- Make it consequence-based: say what happens next in the situation \
because of that choice, then why, grounded in the source. Maximum 40 words
- Never write "Correct," "Incorrect," "Wrong," "Right," or "Not quite." \
For "weak" choices, normalize the attempt, explain the consequence, and \
point to the stronger approach without blame. Use "yet" framing where it \
fits
- Feedback on a "best" choice names the specific reason it worked, not \
just that it did
- Never refer to choices by letter or position. The order changes when \
the learner sees it

ENDINGS
- Each ending's "situation" (maximum 50 words) describes the result of \
that path. Strong paths end well, weaker paths end with a realistic, \
recoverable consequence

APPLY TODAY
- "apply_today" is one sentence with a named trigger and a specific \
action the learner can take within 24 hours ("Next time X happens, do Y")

BLOOM ALIGNMENT
Branching scenarios fit Apply, Analyze, and Evaluate. If the learning \
objective is at the Remember level, a Knowledge Check would serve it \
better; generate what you can and say so in spaced_repetition_notes.

EXPERIENCE LEVEL
- Novice: name the relevant concept in plain terms inside the situation \
and keep the options clearly distinct
- Practicing: realistic constraints, with at least one tempting but \
flawed option
- Expert: realistic ambiguity, with two defensible options and a real \
trade-off between them

VOICE
- Second person, present tense, active voice
- Conversational but disciplined
- No filler phrases, no throat-clearing, no hedging

FEW-SHOT EXAMPLE

Here is one exemplar decision node showing the level of detail expected:

  {
    "id": "n1",
    "kind": "decision",
    "situation": "A teammate tells you they are stuck on a report due Friday. You have 15 minutes before your next meeting. What do you do first?",
    "choices": [
      {
        "text": "Offer to rewrite their draft after your next meeting ends.",
        "feedback": "This clears Friday's deadline, but the cause stays hidden. Your teammate is likely to hit the same block on the next report.",
        "next": "n3",
        "quality": "weak"
      },
      {
        "text": "Ask them to show you the exact step where they are stuck.",
        "feedback": "You learn where the real block is. Their answer shows the gap is the data source, not the writing, so you can point them to the right person.",
        "next": "n2",
        "quality": "best"
      }
    ]
  }

Note the structural details: a concrete time limit and deadline, a \
role instead of a name, choices of similar length, a tempting wrong \
choice, and feedback that names a consequence. This level of specific \
detail separates professional scenarios from generic AI output.

Respond in this JSON schema:
{
  "learning_objective": "string (states one Bloom-verb objective)",
  "estimated_minutes": number,
  "setup": "string",
  "visual_anchor_description": "string (describe one diagram or \
annotated screenshot that carries meaning for this scenario; no \
decorative imagery)",
  "start_node": "string (id of the first decision node)",
  "nodes": [
    {
      "id": "string",
      "kind": "decision | ending",
      "situation": "string",
      "choices": [
        {
          "text": "string",
          "feedback": "string",
          "next": "string (id of an existing node)",
          "quality": "best | acceptable | weak"
        }
      ]
    }
  ],
  "apply_today": "string",
  "spaced_repetition_notes": "string (which decision nodes would benefit \
from resurfacing as a different artifact type later; any gaps or \
ambiguities in the source)"
}
Ending nodes omit the "choices" field.`
}

module.exports = { promptTemplate, resolveDecisionRange }
