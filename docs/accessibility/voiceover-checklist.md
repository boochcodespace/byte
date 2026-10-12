# VoiceOver checklist (Mac)

Automated tests cannot hear a screen reader. A person runs this list with
VoiceOver on a Mac before a release, and again for any page or control that is
new or changed. **Every new piece of UI adds its steps here** (see `CLAUDE.md`).

## How to run

1. Turn VoiceOver on or off with **Cmd+F5**. The VoiceOver key ("VO") is
   **Control+Option**.
2. Use Safari. Start Byte with `npm run dev` and open http://localhost:5173.
3. Move by keyboard only. **Tab** and **Shift+Tab** move between controls;
   **VO+Right** and **VO+Left** read item by item; **VO+Space** presses a control.
4. The **rotor** (**VO+U**) lists headings, landmarks, links, and form controls.
   Use the arrow keys to switch lists.
5. Tick a box only if you heard what the step says. If something is wrong, write
   what you heard under "Notes" at the bottom and tell the team.

**Test the learner preview first and most carefully.** Learners get that view.
The authoring view is for the people who build lessons.

---

## All pages

- [ ] Open the rotor, then Landmarks. You hear a banner and navigation ("Main"),
      and a main region. (The learner preview has no banner.)
- [ ] Press **Tab** once after a page loads. You hear "Skip to main content, link".
      Press **Enter**. Focus moves into the main region.
- [ ] Open the rotor, then Headings. There is exactly one heading level 1, and
      levels never jump (no level 3 straight after level 1).
- [ ] The page title read by VoiceOver (VO+F1, then T, or look at the tab) is
      specific, for example "Settings — Byte", not just "Byte".
- [ ] **Changing pages.** Use a link to go to another page (Projects to Settings,
      the Byte logo, a project card, Preview as learner). You hear "Now on
      <page name>." and focus is on the new page's heading. Repeat with the
      browser Back button.
- [ ] On a page that loads data (a project, a source, a lesson), the page name you
      hear is the real name, not "Byte".
- [ ] Decorative symbols are silent: you never hear "fish", "books", "folder",
      "sparkles", "right arrow", "check mark", or "middle dot" read as separate items.

## Projects page

- [ ] Each project card reads its title, then its description and counts.
- [ ] "New project" opens a form. Focus goes into the first field. Each field reads
      its label, and optional fields say "optional".
- [ ] A save or error is announced (an error reads as an alert).

## Project page

- [ ] The breadcrumb is a navigation landmark called "Breadcrumb". The separators are silent.
- [ ] Style guide, Custom instructions, and Target audience each have a heading and
      a labelled box. Press **Save**: you hear "<name> saved." and the button reads
      "Saved" for about 6 seconds.
- [ ] The Lessons list: each lesson reads its title, status, and time ("over" when over budget).
- [ ] Source cards read the source title.

## Add source and New lesson

- [ ] Heading level 1 is "New source" or "New lesson".
- [ ] Every field reads its label. The source choice list says which source is the primary one.
- [ ] "Plan the lesson" is dimmed (disabled) until a topic and a source are chosen.

## Source page

- [ ] The source text box reads "Source content, edit text". The learner context fields
      each read their label (Role, Experience level, Use case).
- [ ] "Generated artifacts" is a list of buttons. Each reads the artifact type and
      "pressed" or "not pressed". Press one: the artifact appears below it.
- [ ] "Generate" reads without the sparkles.

## Settings page

- [ ] Each field reads its label. The key field is a password field.
- [ ] After saving, "Settings saved…" is announced.
- [ ] An error (wrong key) is announced as an alert and the Retry or Settings link reads clearly.

## Lesson page: blueprint and approval

- [ ] Every section's title, minutes, purpose, and Remove button has a name that says
      which section it belongs to.
- [ ] "Approve blueprint", "Save changes", and "Regenerate blueprint" read clearly.
      "This replaces your edits." is announced when you choose Regenerate.

---

## Learner preview (Preview as learner)

Open a drafted lesson, then **Preview as learner**.

### Start of the page

- [ ] Rotor, Headings: one level 1 (the lesson title), then "How to use this lesson"
      (level 2), each chunk title (level 2), "Apply today", and "Come back and recall".
- [ ] Read "How to use this lesson" in full. It makes sense without seeing the screen
      and says there is no time limit.
- [ ] There are no Edit, Remove, Move, Insert, or Regenerate buttons anywhere, and
      you never hear "Brief for the author", "Generated with", or a time meter.

### Text blocks and visuals

- [ ] A chunk with a visual reads "Visual" and then the alt text.
- [ ] A chunk with a long description also has a button "Describe this visual". It
      reads "collapsed". Press it: it reads "expanded" and the description can be read.
      Press again: "collapsed".
- [ ] A visual marked decorative (or with no alt text yet) is not announced at all.

### Flip cards

- [ ] You hear the card counter ("Card 1 of 4"), the card type ("Hook") with no emoji,
      the question, and a button "Reveal answer".
- [ ] Before you press it, you do **not** hear the answer anywhere on the card.
- [ ] Press **Reveal answer**: you hear "Answer." followed by the answer, and focus is
      now on the button "Show question".
- [ ] Press **Show question**: you hear "Question." followed by the question, and
      focus is back on "Reveal answer".
- [ ] "Next card" and "Previous card" announce "Card 2 of 4." and the new question.
      "Previous card" is dimmed on the first card, "Next card" on the last.
- [ ] The card buttons read "Card 3 of 4, current" for the card you are on and
      "Card 1 of 4" for the others (there is no tab or tablist role).
- [ ] The left and right arrow keys change cards while focus is in the deck.

### Knowledge checks

- [ ] You hear "Your task" and the setup, then "Question 1 of 3", the question, and a
      group of answer buttons.
- [ ] Press an answer: it reads as pressed, the other answers become dimmed, and the
      feedback is announced ("Strongest answer" or "A weaker answer" in words, then
      the reasoning). Focus lands on "Next question".
- [ ] The strongest answer is spelled out in words when you chose a weaker one. Nothing
      depends on a color.
- [ ] After "Next question" you hear "Question 2 of 3" and focus is on it.
- [ ] After the last question you hear "Your results". Each answer is listed with the
      words "Strongest answer" or "A weaker answer".
- [ ] "Try again from the start" returns to "Question 1 of 3" without reloading the page.

### Scenarios

- [ ] You hear "Your task", "Decision 1", the situation, and a group of option buttons.
- [ ] Press an option: the consequence is announced with its quality in words, and
      focus lands on the Continue button. "Try a different choice" puts you back on the options, with focus on the first one.
- [ ] After Continue you hear "Decision 2" (or "How it played out" at the end).
- [ ] The ending lists each choice with its quality in words.
- [ ] "Try again from the start" restarts without reloading the page.

### Tabs

- [ ] The tab list reads as a tab group named by the block title. **Tab** enters it once.
- [ ] You hear "Host, tab, selected, 1 of 2". The right and left arrow keys move and
      select the next or previous tab, wrapping at both ends. **Home** and **End** go
      to the first and last tab.
- [ ] **Tab** leaves the list and lands on the tab's content, which reads its text.
- [ ] A tab with a visual reads the alt text and "Describe this visual" the same way as above.

### Recall prompts

- [ ] "Day 2 recall", "Day 7 recall", and "Day 21 recall" each read their question.
- [ ] Each "Show answer" button has a unique name ("Show answer, day 2 recall question").
      Press it: the answer is read.

---

## Authoring view (lesson page)

### Header, time meter, and announcements

- [ ] The meter is a progress bar named "Lesson time estimate, for authors" and reads
      its value on demand ("6.2 of 10 minutes"). It is **not** announced on every edit.
- [ ] Make the lesson go over its time budget (add artifacts to a short lesson). You
      hear once: "The lesson is now over its time budget…". Remove one to come back
      under: "The lesson is back within its time budget…".
- [ ] "Preview as learner" reads as a link.

### Accessibility check

- [ ] Press **Check accessibility**. You hear "Accessibility check finished: N errors,
      N warnings, N notes." (or "No open problems"). Focus moves to the "Accessibility
      check" heading.
- [ ] The rotor lists "Problems in the content" and "Blocks learners will not see".
- [ ] Each issue reads its severity as a word (Error, Warning, Note), the block it is in,
      and the message. Each **Fix** button reads its full name ("Fix missing alt text in
      chunk: …"). Every **Mark … as reviewed** button also has its own name.
- [ ] **Fix** on an alt text issue opens that chunk's editor with focus inside it.
      **Fix** on a suggestion puts focus on that suggestion's Generate button.
- [ ] **Mark as reviewed** opens a field "Why is this fine?". "Save review" is dimmed
      until you type. Saving announces "Marked as reviewed…". "Undo review" works.
- [ ] After you change the lesson, "The lesson has changed since this check. Run the
      check again." is announced as a status.

### Blocks

- [ ] Every repeated button has a unique name that starts with its visible words:
      "Edit chunk: …", "Regenerate chunk: …", "Remove flip card deck",
      "Insert here, after hook", "Move the chunk … up".
- [ ] **Edit** opens an editor and focus goes to its first field. **Save** or **Cancel**
      returns focus to the block's Edit button.
- [ ] **Remove** asks "Remove this … ?" in a group named "Confirm removing …". "Cancel, keep
      …" returns focus to Remove. Confirming announces "Removed …" and focus goes to
      the page title.
- [ ] **Move up** and **Move down**: after a move you hear "Moved the chunk … down. It is
      now block 4 of 12." and focus stays on the same button (or jumps to the other one
      at an end).
- [ ] **Insert here** opens a menu with focus on its first item. **Cancel** returns focus
      to "Insert here".

### Editors for visuals

- [ ] The visual note box grows as you type. When a visual note exists, a "Text
      alternative" group appears with: "This visual is decorative" (checkbox), "Alt text"
      with a description "N of 125 characters", and an optional "Long description".
- [ ] Past 125 characters you hear "This alt text is N characters. 125 or fewer reads
      best. You can still save it."
- [ ] Press **Generate alt text**: "Drafting…", then "Draft from Byte. Review and edit it,
      then save. It is not saved yet." A failed draft is announced as an alert.
- [ ] In the tabs editor each tab's fields name their tab ("Tab 2 alt text").

### Knowledge check editor (source page and lessons)

Open a knowledge check, then press **Edit** ("Edit knowledge check").

- [ ] **Shared warning.** If another lesson uses this check, you hear "This knowledge
      check is used in other lessons too: <lesson names>. An edit changes it in all of
      them…" with three buttons: "Edit everywhere", "Make a copy for this lesson" (on the
      source page: "Make a copy"), and "Cancel". Focus is on the warning. **Cancel**
      returns focus to Edit.
- [ ] **Make a copy for this lesson.** It announces "Made a copy for this lesson. Now
      editing the copy." and opens the editor with no second warning. The other lessons
      keep the original.
- [ ] **Editor opens.** Focus is in "Task setup". Every field has its label above it
      and reads its full name: "Question 1: Question text", "Question 1, option A:
      Answer text", "Question 1, option A: Explanation". The options are in the stored
      order, A then B then C. A line says learners see them in a shuffled order.
- [ ] **Question cards.** Each question is a section with a heading and one button, for
      example "Question 1: What do you do first?, Key: A, expanded". Open the rotor
      (VO+U), then Headings, to jump between questions. Press the button: it reads
      "collapsed", the fields are no longer reachable with Tab, and the status ("Key: A",
      "Needs a key", "2 writing notes") is still read. Press it again to reopen.
- [ ] **The key.** Each question has a group "Which option is the key? (question 1)" with
      one radio per option, read as "Option A, radio button, selected, 1 of 3". Use
      **Tab** to reach the group and the **arrow keys** to move the key. Only one can be
      selected, and a "Key" badge appears next to it.
- [ ] **Writing advice.** Directly under each question's text you find "Writing advice for
      question 1 (advice only, never blocks saving)" (a heading in the rotor). Make the key
      the longest option: a note names the option and says why. Notes are not announced on
      their own while you type.
- [ ] **Save and Cancel.** They are the last two controls in the editor. Scroll or Tab down
      through a long editor: the Save bar stays at the bottom of the window, and no field you
      Tab to is hidden behind it.
- [ ] **Older file with no key or several keys.** The question reads "Needs a key. No
      option is marked as the key." (or "3 options are marked"). No radio is selected.
      Press **Save changes**: you hear an alert "Save is blocked. Question 2 needs exactly
      one option marked as the key." and focus moves to the "Needs a key" line. Choose a
      key and save: it saves.
- [ ] **From the accessibility checker.** A knowledge check with no key is listed as a
      warning ("Fix knowledge check has no key "question 2" …"). Press its Fix button: the
      editor opens and focus lands on that question's "Needs a key" line.
- [ ] **Save.** Press **Save changes**. You hear "Saved your changes to the knowledge
      check." Focus returns to the Edit button. With nothing changed you hear "No changes
      to save in the knowledge check."
- [ ] **A badge.** "Edited by you" is read after the title once saved.
- [ ] **Regenerate an edited check.** Press Regenerate, fill the panel, press Regenerate
      again: an alert reads "Byte will make a new knowledge check for this lesson. Your
      edited version stays in the project and in any other lesson that uses it." The
      button reads "Make a new one". **Back** returns to the form.
- [ ] **Learner preview.** The edited words are read; nothing says "edited", "needs a
      key", or shows a letter as the key.

### Context panel and pickers

- [ ] "Steer this block" opens with focus in the first field. Experience level and counts
      are labelled selects. The overwrite warning ("replaces the edits you made") is
      announced as an alert before you confirm.
- [ ] The artifact picker lists each artifact with a "Use this …" button that names it.

---

## Not yet covered (add when the feature exists)

- Any export (HTML, SCORM). It must pass this whole list on the exported file, opened on
  its own, before it ships.
- Artifact editors (planned): knowledge check, flip deck, scenario.

## Results log

Add a row each time the list is run in full or in part.

| Date | Who | Safari and macOS version | What was covered | Result and notes |
|---|---|---|---|---|
| | | | | |
