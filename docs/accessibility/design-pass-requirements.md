# Design pass: accessibility requirements

Byte's accessibility fixes so far were made in place, with the smallest visible
change that passes. The later design pass may restyle anything, but it must
keep every minimum on this page. Each item is checked by the automated
accessibility suite; if a restyle breaks one, the suite fails.

## Minimums the design pass must keep (WCAG 2.2 AA)

| Area | Minimum | Today |
|---|---|---|
| Text contrast | 4.5:1 for text under 18 px (3:1 for large text) | all text passes |
| Body and secondary text | 7:1 where it costs little (AAA practice) | secondary `#444444`, muted `#525252` |
| Control and card boundaries | 3:1 against the surface and the page | `--color-border-strong: #8a8a8a` |
| Focus indicator | visible on every interactive element, at least 3px or 2px with 3:1 contrast | 3px outline `#4f46e5` with a white halo |
| Focus never hidden | a focused control is never under a sticky or fixed element (2.4.11) | `scroll-padding-top: 170px` on `html` |
| Target size | at least 24 by 24 CSS px for every button and field (2.5.8) | flip card buttons 24x24 around a 10 px dot |
| Reflow | no horizontal scroll at 320 CSS px or 400% zoom (1.4.10) | passes on every page |
| Text spacing | line height 1.5, letter spacing 0.12em, word spacing 0.16em, paragraph spacing 2em must not clip or scroll (1.4.12) | passes |
| Motion | `prefers-reduced-motion: reduce` turns animation and transitions off (2.3.3) | rule at the end of `index.css` |
| Color | never the only way to show meaning; every status has a text label | severity and feedback labels are text |
| Time meter | an estimate for authors, never a learner time limit | named "Lesson time estimate, for authors" |

## Open design-pass items

### 1. AAA contrast gap (informational, not required for AA)

Axe's `color-contrast-enhanced` rule (7:1) still reports about 346 nodes across
the app. The main causes:

- White text on the indigo accent `#4f46e5` is 6.3:1. It passes AA. A darker
  accent (`#4338ca` is 7.9:1) would pass AAA on every button and badge.
- Small (11 to 13 px) labels in the muted gray `#525252` are about 6.3:1 on the
  tinted backgrounds.
- Accent-colored links and counters on the page background are 5.9:1.

Requirement for the design pass: choose an accent and a tint set that reach 7:1
for text and still keep 3:1 for borders and focus rings, or record why a token
stays below 7:1.

### 2. Visible "estimate" wording on the time meter

The meter's accessible name already says "Lesson time estimate, for authors".
The visible text reads "6.2 of 10 min". It must also say, in words a sighted
author can read, that it is an estimate for authors and not a time limit for
learners (for example "Estimated reading time for authors, not a learner time
limit").

Requirement for the design pass: add the visible wording without making the
sticky meter taller than it is now (focus must stay clear of it, see 2.4.11).

### 3. Quieter authoring controls

Every block shows Move up, Move down and Insert here. Each has a unique
accessible name, so they pass, but the row of buttons is visually heavy.
Requirement: keep one named control per action and the 24 px target size when
these are grouped, collapsed, or moved into a menu. Menus must open and close
with the keyboard and return focus to the button that opened them.
