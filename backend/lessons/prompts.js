// backend/lessons/prompts.js
//
// The two user messages the lesson generator sends. Both ride on the
// shared system prompt (principles, item-writing rules, names policy) and
// on buildPromptContext() for the steering layers, learner context, and
// objectives, exactly like the artifact types.
//
//   blueprintPrompt  — plan the lesson: objective + sections + time
//   textPrompt       — write one text block per approved section, and
//                      propose where artifacts could be inserted
//
// Artifacts are NOT written here. The lesson only proposes placements;
// each artifact is generated later, when the user accepts the proposal.

const { DEFAULT_ARTIFACT_MINUTES, DEFAULT_TABS_MINUTES } = require('./time')

// Share of the lesson time budget given to text (hook, chunks, apply).
// The rest is reserved for the artifacts inserted later.
const TEXT_SHARE = 0.4

function textBudgetMinutes(budget) {
  return Math.round(budget * TEXT_SHARE * 10) / 10
}

function blueprintPrompt(ctx, { topic, budget }) {
  const { sourceContent, steeringBlock, learnerContextBlock, objectivesBlock } = ctx
  const textMax = textBudgetMinutes(budget)

  return `Plan a lesson blueprint for the topic below. This is SECONDARY content \
creation: treat the sources as reference material to faithfully distill, \
not as inspiration for invention. Plan only what the sources support.

═══ LESSON TOPIC ═══
${topic}

${steeringBlock}

${learnerContextBlock}

═══ LEARNING OBJECTIVES ═══
${objectivesBlock}

═══ SOURCES (reference material) ═══
${sourceContent}

═══ REQUIREMENTS ═══

OBJECTIVE
- One learning objective for the whole lesson, with exactly one Bloom verb
- Follow the objectives block above: use a locked objective verbatim; \
otherwise choose the one objective that best fits the topic and the sources

SECTIONS (8 to 10 in total)
- Exactly one "hook" section. It names the job task the learner will be \
able to do and the payoff, up front
- 3 to 5 "chunk" sections. Each teaches ONE idea from the sources. Phrase \
a chunk title as a question where that reads naturally
- Exactly one "apply" section: one thing the learner does within 24 hours, \
with a named trigger
- Exactly three "recall" sections, with recall_day 2, 7, and 21. Each tests \
one idea taught in a chunk, as a stand-alone question
- Order: hook, chunks, apply, then the recall sections by day
- "id" values are "s1", "s2", "s3", and so on, in order
- "purpose" is one sentence on what the section does for the learner
- "source_refs" lists the ids of the sources the section draws on. The ids \
appear in the SOURCE headers above

TIME
- The whole lesson takes ${budget} minutes or less. Flip cards, knowledge \
checks, and scenarios are inserted later, so keep the text lean
- The text sections (hook, chunks, apply) together target at most \
${textMax} minutes. Learners read about 200 words per minute, so one minute \
is about 200 words
- "target_minutes" is the time for each section. Recall sections use 0.5 \
and are not counted in the lesson time

EXPERIENCE LEVEL
- Novice: define terms, go step by step, more scaffolding in the chunks
- Practicing: assume core vocabulary, focus on decisions and common mistakes
- Expert: condensed, lead with exceptions and edge cases

Respond in this JSON schema:
{
  "objective": "string (one Bloom-verb objective)",
  "sections": [
    {
      "id": "s1",
      "kind": "hook | chunk | apply | recall",
      "title": "string",
      "purpose": "string",
      "target_minutes": number,
      "recall_day": 2 | 7 | 21 (recall sections only),
      "source_refs": ["source id"]
    }
  ]
}`
}

function textPrompt(ctx, { topic, objective, blueprint, budget }) {
  const { sourceContent, steeringBlock, learnerContextBlock } = ctx

  const textTarget = blueprint.sections
    .filter(s => s.kind !== 'recall')
    .reduce((sum, s) => sum + (Number(s.target_minutes) || 0), 0)
  const remaining = Math.max(0, Math.round((budget - textTarget) * 10) / 10)
  const d = DEFAULT_ARTIFACT_MINUTES

  return `Write the text of a lesson from the approved blueprint below. This is \
SECONDARY content creation: treat the sources as reference material to \
faithfully distill, not as inspiration for invention.

═══ LESSON TOPIC ═══
${topic}

═══ LESSON OBJECTIVE (locked) ═══
${objective}

${steeringBlock}

${learnerContextBlock}

═══ APPROVED BLUEPRINT ═══
${JSON.stringify(blueprint.sections, null, 2)}

═══ SOURCES (reference material) ═══
${sourceContent}

═══ REQUIREMENTS ═══

BLOCKS
- Write exactly one block for each blueprint section, using its "id" as \
"section_id" and its "kind" as "kind"
- Write each block to its section's "target_minutes". Learners read about \
200 words per minute. Shorter is better
- Plain text only. Separate paragraphs with a blank line. No headings, no \
bullet lists, no markdown
- "source_refs" lists the ids of the sources you drew on
- Use the sources' own frameworks and terms. Do not invent your own
- Second person, active voice, short sentences. Do not name people unless \
the PROJECT STYLE GUIDE explicitly asks for named characters

BY KIND
- hook: 1 to 2 sentences. Name the job task and the payoff. Never open with \
"In this lesson" or a topic announcement
- chunk: teach the ONE idea in the blueprint section in short paragraphs. \
Add a "visual": a diagram or an annotated screenshot that carries meaning. \
Describe it so it could be sketched or captured, and name what each label \
points to. No decorative imagery
- apply: one sentence with a named trigger and a specific action the \
learner can take within 24 hours ("Next time X happens, do Y")
- recall: "body" is a stand-alone question that tests ONE idea from a \
chunk. A learner must be able to answer it from memory with the lesson out \
of sight. Use fresh wording, not the chunk's phrasing. Positive phrasing, \
no "best" alone. "answer" is the expected answer in 25 words or fewer. Set \
"recall_day" from the section

PLACEMENTS (artifacts to insert later)
- Propose 1 to 4 placements. Do not write them. Most are artifacts that \
help the learner practice
- "artifact_type" is one of: flip-card-deck, knowledge-check, \
scenario-branching, tabs. Use each type at most once
- "tabs" is not an artifact. It is a block that lays out 2 to 5 parallel \
ideas, one tab each. Propose it only where the sources compare or layer \
ideas that belong side by side (for example roles, types, or levels). Its \
"note" says what the tabs should compare
- You MUST propose at least one knowledge-check or scenario-branching, so \
the learner retrieves what they learned
- "after_section" is the id of a hook, chunk, or apply section the \
artifact should follow. A flip card deck suits key facts after the chunk \
that teaches them. A knowledge check suits the point where an idea has just \
been taught. A scenario suits the end of the chunks, before the apply block
- "note" is one sentence on why the artifact belongs there
- Time: about ${remaining} minutes remain for artifacts. Inside a lesson a \
flip card deck takes about ${d['flip-card-deck']} minutes (4 cards), a \
knowledge check about ${d['knowledge-check']} (3 questions), and a scenario \
about ${d['scenario-branching']} (2 decisions). A tabs block takes about \
${DEFAULT_TABS_MINUTES}. Propose only what fits, but always include the retrieval \
artifact required above

Respond in this JSON schema:
{
  "blocks": [
    {
      "section_id": "s1",
      "kind": "hook | chunk | apply | recall",
      "body": "string",
      "visual": "string (chunk blocks only)",
      "source_refs": ["source id"],
      "recall_day": 2 | 7 | 21 (recall blocks only),
      "answer": "string (recall blocks only)"
    }
  ],
  "placements": [
    {
      "after_section": "s2",
      "artifact_type": "flip-card-deck | knowledge-check | scenario-branching | tabs",
      "note": "string"
    }
  ]
}`
}

// Write ONE tabs block: 2 to 5 parallel ideas, one per tab. It rides on the
// same steering layers as everything else, including the BLOCK CONTEXT
// section (where the block sits and, if the user typed one, the focus or
// instruction such as "compare host, client, and server").
function tabsPrompt(ctx, { topic, objective, count }) {
  const { sourceContent, steeringBlock, learnerContextBlock } = ctx
  const countRule = count
    ? `Exactly ${count} tabs`
    : '2 to 5 tabs, as many as the content needs'

  return `Write a tabs block for a lesson from the sources below. This is \
SECONDARY content creation: treat the sources as reference material to \
faithfully distill, not as inspiration for invention.

═══ LESSON TOPIC ═══
${topic}

═══ LESSON OBJECTIVE (locked) ═══
${objective}

${steeringBlock}

${learnerContextBlock}

═══ SOURCES (reference material) ═══
${sourceContent}

═══ REQUIREMENTS ═══

PURPOSE
- Tabs let the learner look at one idea at a time. Use them for parallel \
ideas that belong side by side, such as roles, types, or levels
- The BLOCK CONTEXT above says where this block sits. If it gives a Focus, \
that is the instruction: build the tabs around it

STRUCTURE
- ${countRule}
- "title": an optional short heading for the block, phrased as a question \
where that reads naturally
- Each tab has a "label" and a "body"
- "label": one to three words, at most 24 characters. Keep labels parallel, \
for example three roles or three levels
- "body": plain text, at most 50 words, one idea. Give every body the same \
internal order so the learner can compare across tabs
- "visual" (optional, per tab): a diagram or an annotated screenshot that \
carries meaning, described so it could be sketched or captured. Leave it out \
when there is none. No decorative imagery
- Every tab stands alone: the learner may open them in any order

VOICE
- Second person, active voice, short sentences
- Use the sources' own terms and frameworks. Do not invent your own
- Do not name people unless the PROJECT STYLE GUIDE explicitly asks for \
named characters
- No filler, no throat-clearing, no "Correct" or "Wrong"

EXPERIENCE LEVEL
- Novice: define each term in its tab
- Practicing: assume core vocabulary, point to common mistakes
- Expert: condensed, lead with exceptions

Respond in this JSON schema:
{
  "title": "string (optional)",
  "tabs": [
    {
      "label": "string",
      "body": "string",
      "visual": "string (optional)"
    }
  ]
}`
}

// Rewrite ONE text block (hook, chunk, apply, or recall) of a drafted lesson.
// The BLOCK CONTEXT section (placement plus any focus, source section, or
// notes) arrives through the steering block, like every other block.
function textBlockPrompt(ctx, { topic, objective, block, purpose, wordTarget }) {
  const { sourceContent, steeringBlock, learnerContextBlock } = ctx
  const rules = {
    hook: '- "body": 1 to 2 sentences. Name the job task and the payoff. Never open with "In this lesson" or a topic announcement',
    chunk: `- "title": the section title, phrased as a question where that reads naturally
- "body": teach the ONE idea in short paragraphs, about ${wordTarget || 110} words or fewer. Plain text, paragraphs separated by a blank line
- "visual": a diagram or an annotated screenshot that carries meaning. Describe it so it could be sketched or captured, and name what each label points to. No decorative imagery`,
    apply: '- "body": one sentence with a named trigger and a specific action the learner can take within 24 hours ("Next time X happens, do Y")',
    recall: `- "body": a stand-alone question that tests ONE idea from the lesson. A learner must be able to answer it from memory with the lesson out of sight. Use fresh wording. Positive phrasing, no "best" alone
- "answer": the expected answer in 25 words or fewer`,
  }[block.kind]
  const shape = {
    hook: '{ "body": "string" }',
    chunk: '{ "title": "string", "body": "string", "visual": "string" }',
    apply: '{ "body": "string" }',
    recall: '{ "body": "string", "answer": "string" }',
  }[block.kind]

  return `Rewrite one ${block.kind} block of a lesson from the sources below. This is \
SECONDARY content creation: treat the sources as reference material to \
faithfully distill, not as inspiration for invention.

═══ LESSON TOPIC ═══
${topic}

═══ LESSON OBJECTIVE (locked) ═══
${objective}

${steeringBlock}

${learnerContextBlock}

═══ THE BLOCK BEING REPLACED ═══
${block.title ? `Title: ${block.title}\n` : ''}${purpose ? `Purpose: ${purpose}\n` : ''}Current text: ${block.body}
Write a fresh version. Do not copy the current text. If the BLOCK CONTEXT \
above gives a Focus, build the block around it.

═══ SOURCES (reference material) ═══
${sourceContent}

═══ REQUIREMENTS ═══
${rules}
- Plain text only. No headings, no bullet lists, no markdown
- Second person, active voice, short sentences. Use the sources' own terms. \
Do not name people unless the PROJECT STYLE GUIDE explicitly asks for named characters

EXPERIENCE LEVEL
- Novice: define terms, go step by step
- Practicing: assume core vocabulary, focus on decisions and common mistakes
- Expert: condensed, lead with exceptions and edge cases

Respond in this JSON schema:
${shape}`
}

module.exports = { blueprintPrompt, textPrompt, tabsPrompt, textBlockPrompt, textBudgetMinutes }
