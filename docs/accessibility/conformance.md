# WCAG 2.2 Level AA conformance

Byte's target is **WCAG 2.2 Level AA** for everything it renders, in two views:

- **Authoring**: the app and the lesson page an author uses.
- **Learner preview**: the lesson exactly as a learner sees it (`/lessons/:id/preview`),
  which is the stand-in for any export until one exists.

Byte also follows **ATAG 2.0 Part B**: it helps authors make accessible content
and never generates inaccessible content by default (see "Authoring tool support"
below).

**Update this file in every phase.** Change a status or its evidence whenever the
work touches that criterion, and add a row for any new view (an export is its own
view). See `CLAUDE.md` for the definition of done.

- Last updated: D2 commit 2 (flip deck editor; shared editor layout).
- Automated evidence: `npm run test:a11y` (axe on every state in both views, keyboard
  runs, API checks). Test file names below are in `tests/a11y/`, and `ui-artifact-edit` / `api-artifact-edit` are in `tests/artifacts/`.
- Manual evidence: `docs/accessibility/voiceover-checklist.md`. The checklist has to be
  run by a person on a Mac. **No run is recorded in its log yet**, so every "Pass" below
  rests on automation and the code until a person signs the checklist.

## Summary

| Status | Count |
|---|---|
| Pass | 39 |
| Fail | 0 |
| Not applicable | 16 |
| **Total (A and AA, WCAG 2.2)** | **55** |

WCAG 2.2 removed success criterion 4.1.1 (Parsing), so it is not listed.

**There are no failing Level A or AA criteria.** Known gaps at Level AAA and in coverage are listed after the table.

## Success criteria

| SC | Name | Level | Status | View | Evidence |
|---|---|---|---|---|---|
| 1.1.1 | Non-text Content | A | Pass | Both | Every visual has alt text or a decorative reason (schemas require it; `api-alt-text`, `ui-alt-text`). Learners see the alt text, never the author brief (`ui-axe-keyboard`: preview hides authoring). Axe image and name rules: 0 violations on every state. Decorative emoji are `aria-hidden` (`ui-checker-routes`: no exposed emoji on 6 pages and the flip card). Knowledge check and scenario `visual_anchor_description` is an author-only note and is never shown to learners, so it is Not applicable. Flip deck visuals are not rendered yet, so the deck's `alt_text` is stored and checked but not displayed. The flip deck editor lets the author write or draft alt text, a long description, or a decorative reason for the deck's visual; saving a deck that describes a visual without one is refused (`api-flip-edit`, `ui-flip-edit`). |
| 1.2.1 | Audio-only and Video-only (Prerecorded) | A | Not applicable | Both | Byte has no audio or video. |
| 1.2.2 | Captions (Prerecorded) | A | Not applicable | Both | No audio or video. |
| 1.2.3 | Audio Description or Media Alternative (Prerecorded) | A | Not applicable | Both | No audio or video. |
| 1.2.4 | Captions (Live) | AA | Not applicable | Both | No live media. |
| 1.2.5 | Audio Description (Prerecorded) | AA | Not applicable | Both | No video. |
| 1.3.1 | Info and Relationships | A | Pass | Both | Real headings (one `h1`, no skipped levels: `ui-axe-keyboard` headings check on 8 pages), landmarks (banner, `Main` and `Breadcrumb` navigation, main), lists, fieldsets with legends, labels tied to fields, groups with names. Axe: 0 violations. Artifact editors: labels above fields, question cards are headings holding one toggle button, the key is a fieldset with a legend (`ui-editor-layout`). |
| 1.3.2 | Meaningful Sequence | A | Pass | Both | DOM order matches reading order. The hidden side of a flip card is `aria-hidden` and `inert`, so the answer is not read before the flip (`ui-axe-keyboard`). VoiceOver: checklist, Flip cards. |
| 1.3.3 | Sensory Characteristics | A | Pass | Both | Byte's own instructions never rely on shape, color, or position. Generated content is held to the same rule by the Accessibility Rules prompt and the checker's color, position and shape rule (`api-checker`). |
| 1.3.4 | Orientation | AA | Pass | Both | Nothing locks portrait or landscape. Reflow tested at 320 px wide. |
| 1.3.5 | Identify Input Purpose | AA | Not applicable | Authoring | No field collects personal data about the user (fields are titles, text, and an API key). |
| 1.4.1 | Use of Color | A | Pass | Both | Every status has a text label: feedback ("Strongest answer", "A weaker answer"), checker severity (Error, Warning, Note), the current card (`aria-current` and a counter), over-budget (text). Checked in `ui-axe-keyboard` and `ui-checker-routes`. |
| 1.4.2 | Audio Control | A | Not applicable | Both | No audio. |
| 1.4.3 | Contrast (Minimum) | AA | Pass | Both | Axe `color-contrast`: 0 violations on 35 states in `ui-axe-keyboard`, plus every state in the other browser files. Token ratios are asserted (`ui-axe-keyboard`, Contrast tokens). |
| 1.4.4 | Resize Text | AA | Pass | Both | Reflows at 320 CSS px (equal to 400% zoom on a 1280 px window) with no horizontal scroll (`ui-axe-keyboard`, 6 pages and views). Text uses relative layout and is not clipped. |
| 1.4.5 | Images of Text | AA | Not applicable | Both | No images of text. Visuals are described, not embedded. |
| 1.4.10 | Reflow | AA | Pass | Both | No horizontal scroll at 320 CSS px on projects, source, authoring lesson, learner preview, blueprint editor, and settings (`ui-axe-keyboard`). The artifact editor reflows at 320 CSS px with no horizontal scroll; option fields stack below 900 px (`ui-editor-layout`). |
| 1.4.11 | Non-text Contrast | AA | Pass | Both | Control and card borders use `--color-border-strong` (3:1 or more on white, the page, and the accent tint) and the focus ring is 3:1 (`ui-axe-keyboard`, Contrast tokens). Design pass must keep these (`design-pass-requirements.md`). |
| 1.4.12 | Text Spacing | AA | Pass | Both | Line height 1.5, letter 0.12em, word 0.16em, paragraph 2em applied: no clipped text or scroll on the authoring lesson and learner preview (`ui-axe-keyboard`). |
| 1.4.13 | Content on Hover or Focus | AA | Not applicable | Both | Nothing appears only on hover or focus. No tooltips or hover menus (menus open on press). |
| 2.1.1 | Keyboard | A | Pass | Both | Keyboard-only runs: skip link, flip cards, knowledge check, scenario, tabs, the "Describe this visual" button, and the lesson editor (edit, save, remove, move, insert, regenerate, checker) in `ui-axe-keyboard` and `ui-checker-routes`. The source page artifact list is real buttons. The knowledge check editor (source page and lessons) is keyboard-only operable: open, edit, choose the key with the arrow keys, save, cancel (`ui-artifact-edit`). The flip deck editor is keyboard-only operable: open, edit, collapse cards, save, cancel (`ui-flip-edit`). |
| 2.1.2 | No Keyboard Trap | A | Pass | Both | Tabbing through each page (up to 160 stops) and every opened editor, menu and panel leaves them; Cancel returns focus. Checked in `ui-axe-keyboard`. |
| 2.1.4 | Character Key Shortcuts | A | Pass | Learner preview | The only shortcuts are the left and right arrow keys inside a flip deck while focus is in it. They are not character keys, and Space and Enter keep their normal button action. |
| 2.2.1 | Timing Adjustable | A | Pass | Both | No time limits for learners or authors. The lesson time meter is an estimate for authors and is named that way (`ui-axe-keyboard`, Time meter). "Saved" stays 6 seconds and is also announced; it is a status, not a limit. |
| 2.2.2 | Pause, Stop, Hide | A | Pass | Both | Nothing moves automatically except the loading spinner, which is essential to a running action and stops under `prefers-reduced-motion`. |
| 2.3.1 | Three Flashes or Below Threshold | A | Pass | Both | Nothing flashes. |
| 2.4.1 | Bypass Blocks | A | Pass | Authoring | Skip link to the main content (first Tab stop) plus landmarks (`ui-axe-keyboard`). The learner preview has no repeated header. |
| 2.4.2 | Page Titled | A | Pass | Both | Every route has its own title ending "— Byte", for example "Settings — Byte" and "<lesson> (learner preview) — Byte" (`ui-axe-keyboard`, 8 routes). |
| 2.4.3 | Focus Order | A | Pass | Both | Order follows the layout. Opening an editor or menu moves focus in; closing returns it to the opener; removing moves focus to the page title; a page change moves focus to the new h1 (`ui-axe-keyboard`, `ui-checker-routes`). Editor open: focus into the first field; save or cancel: focus back to the Edit button; the shared-artifact warning takes focus (`ui-artifact-edit`). |
| 2.4.4 | Link Purpose (In Context) | A | Pass | Both | Links name their destination. The checker flags vague link text in lesson content (`api-checker`). |
| 2.4.5 | Multiple Ways | AA | Pass | Authoring | Header link to Projects, breadcrumbs on every inner page, and lists of projects, sources and lessons. |
| 2.4.6 | Headings and Labels | AA | Pass | Both | Descriptive headings and labels. Repeated buttons have unique names that start with their visible text ("Edit chunk: …"): `ui-axe-keyboard` checks that no two buttons share a name. |
| 2.4.7 | Focus Visible | AA | Pass | Both | 3px outline with a white halo on every interactive element (`ui-axe-keyboard`, focus indicator check; axe and the keyboard runs). |
| 2.4.11 | Focus Not Obscured (Minimum) | AA | Pass | Both | `scroll-padding-top: 170px` keeps focus clear of the sticky header and time meter: Tab and Shift+Tab through the authoring page and the preview, 0 stops under sticky UI (`ui-axe-keyboard`). The editors' sticky Save bar never covers a focused field: `scroll-padding-bottom` plus a Tab and Shift+Tab run through the editor (`ui-editor-layout`). |
| 2.5.1 | Pointer Gestures | A | Not applicable | Both | No multipoint or path-based gestures. |
| 2.5.2 | Pointer Cancellation | A | Pass | Both | Actions run on the click (up) event only. |
| 2.5.3 | Label in Name | A | Pass | Both | Accessible names start with the visible text, for example "Edit chunk: …" for "Edit". Flip card buttons are named by their visible words. |
| 2.5.4 | Motion Actuation | A | Not applicable | Both | Nothing is operated by shaking or tilting. |
| 2.5.7 | Dragging Movements | AA | Not applicable | Both | Nothing needs dragging. Reordering uses Move up and Move down buttons. (Drag and drop is out of scope; if added later it needs a button alternative.) |
| 2.5.8 | Target Size (Minimum) | AA | Pass | Both | Every button and field is at least 24 by 24 CSS px (`ui-axe-keyboard`, targets on authoring, preview and source pages); axe `target-size`: 0 violations. Flip card buttons are 24 px around a 10 px dot. |
| 3.1.1 | Language of Page | A | Pass | Both | `<html lang="en">` (`ui-axe-keyboard`). |
| 3.1.2 | Language of Parts | AA | Not applicable | Both | Content is in one language. |
| 3.2.1 | On Focus | A | Pass | Both | Focus never changes context. Only pressing a control does. |
| 3.2.2 | On Input | A | Pass | Both | Changing a field never submits or navigates. |
| 3.2.3 | Consistent Navigation | AA | Pass | Authoring | Header and breadcrumbs are in the same place on every page. |
| 3.2.4 | Consistent Identification | AA | Pass | Both | Same actions use the same names (Edit, Remove, Regenerate, Insert here, Move up, Move down). |
| 3.2.6 | Consistent Help | A | Not applicable | Both | Byte has no help mechanism on its pages. |
| 3.3.1 | Error Identification | A | Pass | Authoring | Errors are text and announced as alerts (`ErrorState`, a failed alt text draft, empty review reason); messages name the field or action. Checked in `ui-alt-text`, `ui-checker-routes`. Editor errors are alerts that name the question and option ("Question 1, option C: the answer text cannot be empty."); a save blocked for a missing key names the questions (`api-artifact-edit`, `ui-artifact-edit`). Flip deck editor errors name the card ("Card 2: the front cannot be empty."); a save blocked for missing alt text is an alert (`api-flip-edit`, `ui-flip-edit`). |
| 3.3.2 | Labels or Instructions | A | Pass | Authoring | Every field has a visible label; optional fields say so. Axe `label` and `select-name`: 0 violations on every page. Every editor field has a visible label that names its question and option. |
| 3.3.3 | Error Suggestion | AA | Pass | Authoring | Messages say what to do ("Say why this is fine", "Write the visual note first", "Pick fewer sources"). The needs-a-key flag and the blocked-save alert say what to do ("Choose the one strongest answer"). |
| 3.3.4 | Error Prevention (Legal, Financial, Data) | AA | Not applicable | Authoring | No legal or financial transactions. Removing a block asks for confirmation anyway, and an artifact's files are never deleted. |
| 3.3.7 | Redundant Entry | A | Pass | Authoring | Learner context is prefilled from the source; nothing is asked twice. |
| 3.3.8 | Accessible Authentication (Minimum) | AA | Not applicable | Authoring | Byte has no sign-in. The API key field is a setting, allows paste, and needs no memory or puzzle. |
| 4.1.2 | Name, Role, Value | A | Pass | Both | Axe: 0 violations (names, roles, states) on every state. Native elements are used. The time meter bar has a name and value text; the flip card buttons, the "Describe this visual" disclosure (`aria-expanded`), tabs (roving tabindex, `aria-selected`) and option buttons (`aria-pressed`) are checked. VoiceOver: checklist. The key radios are native radio buttons named "Question 1: option A is the key" (`ui-artifact-edit`). |
| 4.1.3 | Status Messages | AA | Pass | Both | Polite live regions announce flip sides and card changes, feedback, saves, route changes ("Now on …"), moves, removals, going over or back under the time budget, and checker results; errors use `role="alert"`. Checked in `ui-axe-keyboard`, `ui-checker-routes`, `ui-alt-text`. VoiceOver: checklist. Editor saves ("Saved your changes to the knowledge check.", "No changes to save…"), copies, and the blocked-save alert are announced (`ui-artifact-edit`). Flip deck editor saves, copies, drafts, and blocked saves are announced (`ui-flip-edit`). |

## Authoring tool support (ATAG 2.0 Part B)

| Need | How Byte meets it | Evidence |
|---|---|---|
| Never generate inaccessible content by default | The system prompt's Accessibility Rules outrank every other instruction. Schemas require alt text (or a decorative reason) whenever a visual is present, so a missing one fails generation instead of shipping. | `api-alt-text` |
| Help authors write alt text | Alt text, long description and decorative fields in the chunk and tab editors, with a soft 125-character guide and a drafting button. A draft is never saved or counted until the author saves it. | `ui-alt-text`, `api-alt-text` |
| Check content | The lesson checker lists missing alt text, headings, color or position wording, vague or empty links, and what the preview skips. Advisory notes cover reading grade above 8 and acronyms not spelled out. | `api-checker`, `ui-checker-routes` |
| Let the author decide | Any issue can be marked reviewed with a required reason. The review ends when the text changes. | `api-checker` |
| Gate exports | `exportBlockers()` returns open errors; any future export must call it. | `api-checker` |

## Decisions recorded here

- **Knowledge check and scenario `visual_anchor_description`**: an author-only note, never shown to learners. Not applicable to 1.1.1 for learners.
- **Flip deck visuals** are not rendered. The deck's `alt_text` is stored and flagged by the checker when it is missing, but nothing displays it yet.
- **Decks on source pages** are not checked by the lesson checker. Only decks used in a lesson are.
- **Review matching is exact.** A review belongs to the exact text that caused the issue.
- **Reading level and acronyms** are advisory notes only. They never block an export.
- **There is no export yet.** When one exists it needs its own view in this file and must pass the same axe, keyboard and VoiceOver checks as the learner preview.
- **Artifact editors (D2).** Version 1 edits text only; there is no adding or removing of questions, options, cards, or decisions. The knowledge check and flip deck editors are done; the scenario editor follows. Writing notes (item-writing advice) are advisory and never block saving; the key rule is the only blocker.
- **Shared artifacts.** An artifact is shared by every lesson that references it. Before an edit that would change other lessons, the author chooses to edit everywhere or make a copy for this lesson.
- **No dragging.** Reordering is by buttons. Drag and drop is out of scope.

## Known gaps

| Item | Level | Detail | Plan |
|---|---|---|---|
| Enhanced contrast (1.4.6) | AAA | Axe's 7:1 rule still reports about 346 nodes across the app: white text on the indigo accent is 6.3:1, and small muted labels on tinted backgrounds are about 6.3:1. Body and secondary text are already 7:1 or better. | Design pass requirement 1 in `design-pass-requirements.md`. |
| Time meter wording | AA practice | The meter's accessible name says it is an estimate for authors, but its visible text does not. | Design pass requirement 2. |
| Manual VoiceOver run | All | No run is logged yet. | Run `voiceover-checklist.md` and add a row to its log. |
| Authoring controls are heavy | Usability | Many Move and Insert buttons per block. Each is named and 24 px, but visually busy. | Design pass requirement 3. |
| Route focus on failed loads | AA practice | A page that fails to load moves focus to the main region after three seconds. | Acceptable; revisit with the design pass. |
