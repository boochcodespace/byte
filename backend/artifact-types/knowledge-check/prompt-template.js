// artifact-types/knowledge-check/prompt-template.js
//
// Builds the user message Claude sees when asked to generate a
// knowledge check. Common steering / context / objective blocks come
// from the shared buildPromptContext() helper; this file owns the
// item-writing rules and the JSON response schema.
//
// Item rules are adapted from the cert-item-writer skill: one concept
// per item, self-contained stems, plausible distractors built from real
// mistakes, no cueing, and a rationale for every option. Where the skill
// and Byte's principles differ, Byte wins: grade 8 reading level (not
// grade 6), consequence-based feedback, and a retrieval-first flow in
// which the learner commits before any rationale is shown.
//
// Answer position is randomized by the renderer, not trusted to the
// model, because models tend to favor certain positions. The prompt
// still asks for variety, and forbids rationales that point at options
// by letter, since letters change when the renderer shuffles.

function promptTemplate(ctx /* , extras — knowledge-check has none today */) {
  const { sourceContent, steeringBlock, learnerContextBlock, objectivesBlock } = ctx

  return `Generate a knowledge check from the following source content. This is \
SECONDARY content creation: treat the source as reference material to \
faithfully distill, not as inspiration for invention. Every question, \
correct answer, and distractor must trace back to the source.

${steeringBlock}

${learnerContextBlock}

═══ LEARNING OBJECTIVES ═══
${objectivesBlock}

═══ SOURCE CONTENT (reference material) ═══
${sourceContent}

═══ REQUIREMENTS ═══

SIZING
- 4 to 6 items when the source is rich
- 3 to 4 items when the source is thin (do not pad)
- Single-best-answer multiple choice only
- Each item takes the learner under 120 seconds
- Total completion time under 5 minutes
- One learning objective for the whole check, stated at the top
- Every item tests exactly one concept from the source. If you need \
"and" to describe what an item tests, split it

STRUCTURE
- "setup": 1 to 2 sentences in second person that name the job task the \
learner is practicing and the payoff for getting it right
- "id": short strings such as "q1", "q2", "q3"
- "bloom_level": the Bloom level the item actually requires. Match the \
verb in the learning objective. Unless the objective sits at another \
level, favor Apply and Analyze over recall
- "difficulty": foundation, intermediate, or advanced
- "scenario" (optional): 2 to 4 sentences of realistic workplace \
context, written in second person. Use it only when the item needs it. \
Include only details that matter to the answer

STEM RULES
- The stem is self-contained. A prepared learner should be able to read \
the stem, cover the options, and form an answer
- Write the stem as a complete, focused question, in second person
- Use positive phrasing. Avoid "NOT" and "EXCEPT" stems. If one is \
unavoidable, write the negative word in capitals
- No double negatives
- Do not use "best" alone. Say what makes an answer stronger, such as \
"most efficient" or "most likely to prevent rework"
- Do not name people in stems or scenarios. Use "you," "a team \
member," or "your manager," unless the PROJECT STYLE GUIDE explicitly \
asks for named characters
- Nothing in the stem or scenario may hint at which option is correct

OPTION RULES
- 3 options by default. Use 4 only when you have 3 distractors that are \
all plausible
- Exactly one option has "correct": true
- Build every distractor from a real misconception, common mistake, or \
reasonable-but-incorrect approach found in the source. Ask: would a \
partially prepared learner actually choose this? Do not invent filler \
options
- Keep options similar in length, specificity, and tone. The correct \
option must not be the longest or the most detailed
- Keep options grammatically consistent with the stem
- Options are mutually exclusive. No overlap between them
- No "All of the above," "None of the above," or combined answers such \
as "A and C"
- No option bundles two claims with "and"
- Avoid absolutes ("always," "never," "only") unless they appear \
equally across the options
- Do not repeat distinctive stem words in the correct option alone
- Vary which position the correct option takes from item to item

RATIONALE (shown only AFTER the learner commits to an answer)
- Every option has a "rationale" of maximum 35 words
- For the correct option, name the specific reason it works in this \
situation, grounded in the source
- For each distractor, name the misconception behind it and what choosing \
it leads to, without blame. Use "yet" framing where it fits
- Never write "Correct," "Incorrect," "Wrong," "Right," or "Not quite"
- Never refer to options by letter or position. The order changes when \
the learner sees it

RETRIEVAL
- The learner must commit to an answer before any rationale appears, so \
write each stem to be answered from what the source taught, not from \
hints in the question

APPLY TODAY
- "apply_today" is one sentence with a named trigger and a specific \
action the learner can take within 24 hours ("Next time X happens, do Y")

BLOOM ALIGNMENT
Multiple-choice items suit Remember, Understand, Apply, and Analyze. If \
the learning objective is at the Evaluate or Create level, write the \
strongest items you can at Analyze and say so in spaced_repetition_notes; \
a Scenario would serve that objective better.

EXPERIENCE LEVEL
- Novice: define terms in the stem or scenario and test one clear idea \
with distinct options
- Practicing: realistic constraints, with at least one tempting but \
flawed distractor
- Expert: realistic ambiguity, two defensible options, and a real \
trade-off between them

VOICE
- Second person, present tense, active voice
- Short sentences. Plain words. Define jargon on first use
- No filler phrases, no throat-clearing, no hedging

FEW-SHOT EXAMPLE

Here is one exemplar item showing the level of detail expected:

  {
    "id": "q1",
    "bloom_level": "Apply",
    "difficulty": "intermediate",
    "scenario": "Your weekly report is due at noon. At 10:30 you see the sales total is 12% lower than last week, and the pipeline has not changed.",
    "stem": "What should you do first?",
    "options": [
      {
        "text": "Compare this week's data filters with last week's.",
        "correct": true,
        "rationale": "A changed filter is the most common cause of a sudden drop with no real change. Checking it first takes two minutes and may fix the number before the deadline."
      },
      {
        "text": "Ask the sales lead to confirm that the total is right.",
        "correct": false,
        "rationale": "This feels safe, but it hands the problem to someone else and uses time you do not have. The sales lead sees the same drop."
      },
      {
        "text": "Add a note that the total may be low, then send it.",
        "correct": false,
        "rationale": "This meets the deadline, but readers may act on a number you suspect is wrong. A quick check comes before a caveat."
      }
    ]
  }

Note the structural details: a real constraint (noon deadline), options \
of similar length, distractors that reflect what a hurried person would \
actually do, and rationales that name a consequence. This level of \
specific detail separates professional items from generic AI output.

Respond in this JSON schema:
{
  "learning_objective": "string (states one Bloom-verb objective)",
  "estimated_minutes": number,
  "setup": "string",
  "visual_anchor_description": "string (describe one diagram or \
annotated screenshot that carries meaning for this check; no decorative \
imagery)",
  "items": [
    {
      "id": "string",
      "bloom_level": "Remember | Understand | Apply | Analyze",
      "difficulty": "foundation | intermediate | advanced",
      "scenario": "string (optional)",
      "stem": "string",
      "options": [
        {
          "text": "string",
          "correct": true or false,
          "rationale": "string"
        }
      ]
    }
  ],
  "apply_today": "string",
  "spaced_repetition_notes": "string (which items would benefit from \
resurfacing as a different artifact type later; any gaps or \
ambiguities in the source)"
}`
}

module.exports = { promptTemplate }
