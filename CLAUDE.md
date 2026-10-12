# Byte: notes for Claude Code

Byte is a local learning-content studio (React frontend, Express backend, files
in `~/Byte`). Run it with `npm run dev`. The README explains the rest.

## Accessibility is the definition of done

Accessibility is a release requirement in Byte, not polish. **WCAG 2.2 Level AA
is the definition of done for everything Byte renders:** the authoring app, the
lesson page, the learner preview, and every artifact renderer. Byte is also an
authoring tool, so it follows ATAG 2.0 Part B: it must help authors produce
accessible content and must never generate inaccessible content by default.

### No commit is complete until all of these are true

1. **Axe shows zero violations** at WCAG 2.2 A and AA on every page and every
   artifact state, in both views (authoring and learner preview).
2. **The keyboard-only runs pass.** Every action works with the keyboard alone,
   in a logical order, with no keyboard trap, and focus is never lost or hidden.
3. **New UI is added to `docs/accessibility/voiceover-checklist.md`** in plain
   steps, under the page or artifact it belongs to. Automation cannot hear what
   a screen reader says, so a person runs the new steps with VoiceOver.
4. **`docs/accessibility/conformance.md` is updated** for the phase: change a
   success criterion's status or evidence if the work touched it, and add new
   evidence for anything new.
5. **New or changed tests are in the suite.** A fix without a test that would
   fail without it is not done.

Run the whole accessibility suite with one command from the repo root:

```
npm run test:a11y          # everything
npm run test:a11y -- api   # API files only
npm run test:a11y -- ui    # browser files only
```

Stop `npm run dev` first. The suite needs ports 3001 and 5173 and uses a
throwaway home folder, so your real `~/Byte` is never touched. First time only:
`npm run test:a11y:setup` (installs the test packages and downloads Chromium).

If a test fails, fix the product. Do not loosen a test, skip a state, or add an
axe `disableRules` exception to get a green run. If a rule truly does not apply,
say so in `conformance.md` with the reason.

### Rules for new and changed UI

- Real elements first: `button` for actions, `a` for navigation, `label` tied to
  every field, headings in order with no skipped level, one `h1` per page.
- Every repeated button has a unique accessible name that starts with its
  visible text, for example "Edit chunk: What is changeover time?".
- Keyboard: when something opens, move focus into it; when it closes, return
  focus to what opened it; when the thing you were on disappears, move focus
  somewhere sensible and announce it.
- Announce changes (feedback, saves, errors, removals, route changes) through a
  polite live region that already exists in the page, or `role="alert"` for
  errors. Do not rely on color, position, or shape alone; give status a text
  label.
- Decorative emoji and symbols are `aria-hidden`; the text beside them carries
  the meaning.
- Respect `prefers-reduced-motion`. Nothing flashes. Nothing is a learner time
  limit. The lesson time meter is an estimate for authors only.
- Targets are at least 24 by 24 CSS pixels. Text is 4.5:1, UI components and
  focus indicators 3:1. No horizontal scroll at 320 CSS pixels.

### Generated content

The system prompt has an **Accessibility Rules** section (alt text or a
decorative reason for every visual, no color-only or position-only references,
real headings, grade 8 plain language with acronyms spelled out, descriptive
link text, feedback that reads aloud on its own). It outranks the style guide,
custom instructions, per-generation prompt, and block context. Do not weaken it.
Schemas require alt text (or a decorative reason) wherever a visual is present.

### Lesson accessibility checker

`backend/lessons/a11y-check.js` lists accessibility problems in a lesson. Open
errors block an export; warnings and advisory notes (reading level, acronyms)
do not. Reviews need a reason and match the exact text, so they end when the
text changes. Add a rule here whenever you add a way for content to be
inaccessible.

### Exports

Any future export (HTML, SCORM, or other) must:

1. call `exportBlockers()` from `backend/lessons/a11y-check.js` first and refuse
   to export while it returns anything;
2. pass the **same axe, keyboard, and VoiceOver checks as the learner preview**
   before it ships, with the exported file opened on its own (not inside Byte);
3. be added to `conformance.md` as its own view.

### Design pass

A later design pass may restyle anything, but it must keep every minimum in
`docs/accessibility/design-pass-requirements.md` (contrast tokens, focus ring,
target size, reflow, reduced motion, scroll padding for the sticky header). The
suite checks them, so a restyle that breaks one fails the run.

## Standing project rules

- Work in small commits that list their files. Do not open a pull request unless
  asked. Do not add dependencies without saying so.
- Stop at each approval checkpoint; do not start a later phase until it is named.
- Items noticed but out of scope go under "Noticed, not done" in the report.
