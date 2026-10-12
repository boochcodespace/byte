// Browser: the flip card deck editor (D2 commit 2), on the source page and in
// lessons: the shared layout, card notes, the deck's visual alt text fields and
// Generate alt text, needs-alt-text, the shared-artifact warning and copy,
// regenerate wording, progress protection, the checker's Fix, axe on every
// editor state, and a keyboard-only run.
// Run by `npm run test:all`. Uses a mock AI model and a throwaway HOME.
const h = require('../a11y/support/ui-harness')
const { APP, HOME, L, MOCK, P, PRIMARY, api, check, draftViaApi, fs, path, setMode, sleep } = h
const { AxeBuilder } = require('@axe-core/playwright')
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function main() {
  await h.startEnv({ ui: true })
  await api('GET', '/projects')
  await api('POST', '/settings', { provider: 'local', model: 'm', baseUrl: `${MOCK}/v1` })
  const GEN = `/projects/${P}/sources/${PRIMARY}/artifacts/generate`
  const A = `/projects/${P}/artifacts`
  const artDir = f => path.join(HOME, 'Byte', 'projects', P, 'sources', PRIMARY, 'artifacts', f)
  const readArt = f => JSON.parse(fs.readFileSync(path.join(artDir(f), 'artifact.json'), 'utf-8'))
  const writeArt = (f, a) => fs.writeFileSync(path.join(artDir(f), 'artifact.json'), JSON.stringify(a))
  const lessonOf = async id => (await api('GET', `${L}/${id}`)).data
  const refsOf = async type => (await api('GET', `${A}?type=${type}`)).data
  for (const t of ['knowledge-check', 'scenario-branching', 'flip-card-deck']) { await sleep(5); await api('POST', GEN, { artifactType: t }) }
  const deck1 = (await refsOf('flip-card-deck'))[0], kcRef = (await refsOf('knowledge-check'))[0], scRef = (await refsOf('scenario-branching'))[0]
  const accept = async (lid, type, ref) => {
    const b = (await lessonOf(lid)).lesson.blocks.find(x => x.artifact_type === type && x.state === 'proposed')
    return api('POST', `${L}/${lid}/blocks/${b.id}/artifact`, { mode: 'existing', source: ref.source, artifact: ref.folder })
  }
  const L1 = await draftViaApi({ topic: 'First lesson' }, {})
  const L2 = await draftViaApi({ topic: 'Second lesson' }, {})
  await accept(L1, 'flip-card-deck', deck1); await accept(L1, 'knowledge-check', kcRef); await accept(L1, 'scenario-branching', scRef)
  await accept(L2, 'flip-card-deck', deck1)
  const L2title = (await lessonOf(L2)).lesson.title

  const browser = await h.launchBrowser()
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 1100 } })).newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(m.text()) })
  const base = `${APP}/projects/${P}`
  const go = async u => { await page.goto(u); await page.waitForTimeout(600) }
  const scan = async state => {
    const r = await new AxeBuilder({ page }).withTags(WCAG).analyze()
    check(`axe 0 violations (WCAG 2.2 AA): ${state}`, r.violations.length === 0, r.violations.map(v => `${v.id} ${v.nodes[0].target.join(' ')}`))
  }
  const activeName = () => page.evaluate(() => { const e = document.activeElement; return (e.getAttribute('aria-label') || (e.labels && e.labels[0] && e.labels[0].textContent) || e.textContent || '').trim().slice(0, 90) })
  const SRC = `${base}/sources/${PRIMARY}`
  const editor = () => page.locator('form[aria-label="Edit flip card deck"]')
  const status = () => page.locator('[role=status]:has-text("flip card deck")').first()
  const card = n => editor().locator('section.ae-card').nth(n)      // 0 is the deck visual; cards are 1..4
  const fld = (n, label) => card(n).getByRole('textbox', { name: `Card ${n}: ${label}`, exact: true })
  const pickDeck = async () => { await page.locator('.artifact-item:has-text("Flip Card Deck")').first().click(); await page.waitForTimeout(300) }
  const editBtn = page.getByRole('button', { name: 'Edit flip card deck' })

  try {
    console.log('=== SOURCE PAGE ===')
    await go(SRC); await pickDeck()
    check('the preview has an Edit button for a flip deck', await editBtn.isVisible())
    await editBtn.click()
    const gate = page.locator('.artifact-edit-gate')
    await gate.waitFor()
    check('shared by two lessons: the warning names both and offers the two actions', /used in 2 lessons/.test(await gate.textContent()) && (await gate.textContent()).includes(`"${L2title}"`) && await gate.getByRole('button', { name: 'Edit everywhere' }).isVisible() && await gate.getByRole('button', { name: 'Make a copy' }).isVisible())
    await scan('flip deck: shared-artifact warning')
    await gate.getByRole('button', { name: 'Edit everywhere' }).click()
    await editor().waitFor()

    console.log('=== THE EDITOR ===')
    const form = editor()
    check('focus moves into the first card\'s front', await page.evaluate(() => document.activeElement.tagName === 'TEXTAREA' && /Front/.test(document.activeElement.labels[0].textContent)))
    check('the deck visual and four cards are sections, all open', (await form.locator('section.ae-card').count()) === 5 && (await form.locator('.ae-card-toggle[aria-expanded="true"]').count()) === 4)
    const labels = await form.locator('.ae-field > label').evaluateAll(ls => ls.map(l => { const f = l.parentElement.querySelector('textarea'); const a = l.getBoundingClientRect(), b = f.getBoundingClientRect(); return a.bottom <= b.top + 1 && Math.abs(a.left - b.left) < 2 && getComputedStyle(l).textTransform === 'none' }))
    check('every label is above its field and in sentence case', labels.length === 8 && labels.every(Boolean), labels)
    const [fr, bk] = [await fld(1, 'Front').boundingBox(), await fld(1, 'Back').boundingBox()]
    check('front and back sit side by side on a wide editor', Math.abs(fr.y - bk.y) < 3 && bk.x > fr.x + fr.width - 2, { fr, bk })
    check('each card header shows its number, its front, and a status (the card type)', /^Card 1: front 1/.test(await card(1).locator('.ae-card-toggle').textContent()) && /Hook/.test(await card(1).locator('.ae-card-toggle').textContent()))
    check('fields are named "Card 1: Front" and "Card 1: Back"', (await fld(1, 'Front').inputValue()) === 'front 1' && (await fld(1, 'Back').inputValue()) === 'back 1')
    check('there are no Add or Remove card buttons', !(await form.locator('button:has-text("Add"), button:has-text("Remove")').count()))
    check('the deck\'s visual fields are there: description, alt text, long description, decorative', await form.getByLabel(/Visual note/).isVisible() && await form.getByLabel('Alt text').isVisible() && await form.getByLabel(/Long description/).isVisible() && await form.getByLabel(/This visual is decorative/).isVisible())
    check('alt text starts with the saved value', (await form.getByLabel('Alt text').inputValue()) === 'DECK-ALT')
    // live notes
    await fld(2, 'Front').fill('Remember to list the changeover minutes first every time')
    await fld(2, 'Back').fill('List the changeover minutes first.')
    check('a front that gives away its back adds a note, live, and the header status counts it', await card(2).locator('.ae-notes li:has-text("gives the answer away")').isVisible() && /1 writing note/.test(await card(2).locator('.ae-card-toggle').textContent()))
    await fld(3, 'Front').fill(Array.from({ length: 24 }, (_, i) => `word${i}`).join(' '))
    check('a front over 20 words adds a note with its count', await card(3).locator('.ae-notes li:has-text("24 words")').isVisible())
    await scan('flip deck: editor with writing notes')
    // Generate alt text
    await form.getByLabel(/Visual note/).fill('A diagram of the host and client roles in a call.')
    await form.getByRole('button', { name: /Generate alt text/ }).click()
    await form.locator('text=Draft from Byte').waitFor()
    check('Generate alt text drafts from the visual note, and says it is not saved', /^DRAFT-ALT A diagram/.test(await form.getByLabel('Alt text').inputValue()) && /DRAFT-LONG/.test(await form.getByLabel(/Long description/).inputValue()) && await form.locator('[role=status]:has-text("not saved yet")').isVisible())
    check('nothing is saved by drafting', readArt(deck1.folder).edited === undefined && readArt(deck1.folder).alt_text === 'DECK-ALT')
    await fld(1, 'Front').fill('NEW FRONT one: what do you do first?')
    await form.getByRole('button', { name: 'Save changes' }).click()
    await page.waitForFunction(() => !document.querySelector('form[aria-label="Edit flip card deck"]'))
    const saved = readArt(deck1.folder)
    check('saved with notes showing (advice never blocks): edited, new front, new alt text', saved.edited === true && saved.cards[0].front === 'NEW FRONT one: what do you do first?' && /^DRAFT-ALT/.test(saved.alt_text) && /DRAFT-LONG/.test(saved.long_description) && saved.visual_anchor_description.startsWith('A diagram'))
    check('focus returns to Edit; the save is announced; an "Edited by you" badge shows', (await activeName()) === 'Edit flip card deck' && /Saved your changes to the flip card deck\./.test(await status().textContent()) && await page.locator('.artifact-preview .lesson-badge:has-text("Edited by you")').isVisible())
    check('the card on the page shows the new front', await page.locator('.artifact-preview >> text=NEW FRONT one').isVisible())
    check('the other lessons show it too', (await lessonOf(L2)).artifacts[`${PRIMARY}/${deck1.folder}`].cards[0].front === 'NEW FRONT one: what do you do first?')
    await scan('flip deck: source page after saving')

    console.log('=== NEEDS ALT TEXT ===')
    await sleep(5); await api('POST', GEN, { artifactType: 'flip-card-deck' })
    const deck2 = (await refsOf('flip-card-deck'))[0]
    const old = readArt(deck2.folder); delete old.alt_text; writeArt(deck2.folder, old)
    await go(SRC); await pickDeck()
    await editBtn.click(); await editor().waitFor()
    const flag = editor().locator('.ae-flag')
    check('an older deck with a visual and no alt text is flagged "Needs alt text"', await flag.isVisible() && /Needs alt text/.test(await flag.textContent()))
    await fld(1, 'Front').fill('Edited front on an older deck')
    await editor().getByRole('button', { name: 'Save changes' }).click()
    check('Save is blocked with an alert, and focus moves to the flag', /Save is blocked\. The deck describes a visual, so it needs alt text/.test(await editor().locator('[role=alert]').first().textContent()) && await page.evaluate(() => document.activeElement.classList.contains('ae-flag')))
    check('nothing was written', readArt(deck2.folder).edited === undefined)
    await scan('flip deck: needs alt text, save blocked')
    await editor().getByLabel(/This visual is decorative/).check()
    await editor().getByRole('button', { name: 'Save changes' }).click()
    check('decorative with no reason is blocked too, in words', /Say why the visual is decorative/.test(await editor().locator('[role=alert]').first().textContent()))
    await editor().getByLabel('Why is it decorative?').fill('A border only.')
    await editor().getByRole('button', { name: 'Save changes' }).click()
    await page.waitForFunction(() => !document.querySelector('form[aria-label="Edit flip card deck"]'))
    check('with a decorative reason it saves, and drops alt text', readArt(deck2.folder).decorative === true && readArt(deck2.folder).decorative_reason === 'A border only.' && readArt(deck2.folder).cards[0].front === 'Edited front on an older deck')

    console.log('=== LESSON PAGE ===')
    await go(`${base}/lessons/${L1}`)
    const deckBlock = page.locator('.lesson-artifact').filter({ hasText: 'Flip Card Deck' })
    await page.locator('.scenario-choice').first().click()
    await page.locator('.lesson-artifact:has(.kc) .kc-option').first().click()
    const scenarioAnswered = async () => (await page.locator('.scenario-feedback').isVisible()) && (await page.locator('.scenario-choice:disabled').count()) >= 1
    const kcAnswered = async () => (await page.locator('.kc-feedback').isVisible()) && (await page.locator('.kc-option:disabled').count()) === 3
    await deckBlock.locator('.flipcard:not(.flipped) .flipcard-front .flipcard-flip').click(); await page.waitForTimeout(500)
    check('(setup) a scenario and a knowledge check are answered, and the deck is flipped', await scenarioAnswered() && await kcAnswered() && /flipped/.test(await deckBlock.locator('.flipcard').getAttribute('class')))
    await page.getByRole('button', { name: /^Edit flip card deck/ }).click()
    await deckBlock.locator('.artifact-edit-gate').waitFor()
    check('the lesson warns about the OTHER lesson only', (await deckBlock.locator('.artifact-edit-gate').textContent()).includes(`"${L2title}"`) && !(await deckBlock.locator('.artifact-edit-gate').textContent()).includes('"First lesson"'))
    const refBefore = (await lessonOf(L1)).lesson.blocks.find(b => b.artifact_type === 'flip-card-deck').ref.artifact
    await deckBlock.locator('.artifact-edit-gate').getByRole('button', { name: 'Make a copy for this lesson' }).click()
    await editor().waitFor()
    const l1ref = (await lessonOf(L1)).lesson.blocks.find(b => b.artifact_type === 'flip-card-deck').ref
    check('this lesson now uses a copy in the same source folder; the other lesson keeps the original', l1ref.artifact !== refBefore && l1ref.source === PRIMARY && readArt(l1ref.artifact).edited === true && (await lessonOf(L2)).lesson.blocks.find(b => b.artifact_type === 'flip-card-deck').ref.artifact === refBefore)
    check('the editor opens on the copy without a second warning', !(await deckBlock.locator('.artifact-edit-gate').count()))
    await fld(1, 'Back').fill('ONLY IN THE FIRST LESSON back text')
    await editor().getByRole('button', { name: 'Save changes' }).click()
    await page.waitForFunction(() => !document.querySelector('form[aria-label="Edit flip card deck"]'))
    check('PROTECTION: the scenario answer and the knowledge check answer survived the edit and save', await scenarioAnswered() && await kcAnswered())
    check('the edited deck starts fresh on the front, with the new back on its card', !/flipped/.test(await deckBlock.locator('.flipcard').getAttribute('class')))
    check('the other lesson still shows the original words', (await lessonOf(L2)).artifacts[`${PRIMARY}/${refBefore}`].cards[0].back !== 'ONLY IN THE FIRST LESSON back text')
    check('focus is back on Edit, with the block showing "Edited by you"', /^Edit flip card deck/.test(await activeName()) && await deckBlock.locator('.lesson-badge:has-text("Edited by you")').isVisible())
    await scan('lesson page: after editing a deck')

    console.log('=== REGENERATE ===')
    await page.getByRole('button', { name: /^Regenerate flip card deck/ }).click()
    await deckBlock.locator('.context-panel button:has-text("Regenerate")').click()
    check('the agreed warning, with the deck\'s name', (await deckBlock.locator('.context-panel [role=alert]').textContent()) === 'Byte will make a new flip card deck for this lesson. Your edited version stays in the project and in any other lesson that uses it.', await deckBlock.locator('.context-panel [role=alert]').textContent())
    check('and a "Make a new one" button', await deckBlock.locator('.context-panel button:has-text("Make a new one")').isVisible())
    await deckBlock.locator('.context-panel button:has-text("Back")').click()
    check('Back changes nothing', (await lessonOf(L1)).lesson.blocks.find(b => b.artifact_type === 'flip-card-deck').ref.artifact === l1ref.artifact)
    await deckBlock.locator('.context-panel button:has-text("Cancel")').click()

    console.log('=== THE CHECKER ===')
    const legacy = readArt(deck2.folder); delete legacy.decorative; delete legacy.decorative_reason; writeArt(deck2.folder, legacy)
    const L3 = await draftViaApi({ topic: 'Third lesson' }, {})
    await accept(L3, 'flip-card-deck', deck2)
    await go(`${base}/lessons/${L3}`)
    const checker = page.locator('.a11y-checker')
    await checker.getByRole('button', { name: 'Check accessibility' }).click()
    const issue = checker.locator('.a11y-issue:has-text("describes a visual but has no alt text")')
    await issue.waitFor()
    await issue.getByRole('button', { name: /^Fix flip deck without alt text/ }).click()
    await editor().waitFor()
    check('the checker\'s Fix opens the deck editor', await page.evaluate(() => !!document.activeElement.closest('form')) && await editor().locator('.ae-flag').isVisible())
    await page.getByRole('button', { name: 'Cancel' }).click()

    console.log('=== KEYBOARD ONLY ===')
    await go(`${base}/lessons/${L2}`)
    await page.keyboard.press('Tab'); await page.keyboard.press('Enter')
    const edit2 = page.getByRole('button', { name: /^Edit flip card deck/ })
    await edit2.focus(); await page.keyboard.press('Enter')
    await editor().waitFor()
    check('keyboard: nobody else uses it now, so the editor opens straight away (no warning)', !(await page.locator('.artifact-edit-gate').count()))
    check('keyboard: focus lands in the first card\'s front', /Card 1: Front/.test(await activeName()))
    await page.keyboard.type(' (typed)')
    check('keyboard: typing edits it', (await fld(1, 'Front').inputValue()).includes('(typed)'))
    await card(2).locator('.ae-card-toggle').focus(); await page.keyboard.press('Enter')
    check('keyboard: Enter collapses a card and hides its fields', (await card(2).locator('.ae-card-toggle').getAttribute('aria-expanded')) === 'false' && !(await fld(2, 'Front').isVisible()))
    await page.keyboard.press('Space')
    check('keyboard: Space opens it again', await fld(2, 'Front').isVisible())
    for (let i = 0; i < 80 && (await activeName()) !== 'Save changes'; i++) await page.keyboard.press('Tab')
    check('keyboard: Tab reaches Save changes', (await activeName()) === 'Save changes')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => !document.querySelector('form[aria-label="Edit flip card deck"]'))
    check('keyboard: saving returns focus to Edit and announces it', /^Edit flip card deck/.test(await activeName()) && /Saved your changes/.test(await status().textContent()))
    check('keyboard: the edit is on disk', readArt(refBefore).cards[0].front.includes('(typed)'))

    console.log('=== THE LEARNER VIEW ===')
    await go(`${base}/lessons/${L1}/preview`)
    const pv = await page.locator('main').innerText()
    check('learners get the edited words', (await page.locator('main').textContent()).includes('ONLY IN THE FIRST LESSON back text'))
    check('no "Edited by you", "writing note", or "Needs alt text" for learners', !/Edited by you|writing note|Needs alt text|Edit flip card deck/.test(pv))
    await scan('learner preview with an edited deck')

    check('no page errors', errors.length === 0, errors)
  } finally {
    await browser.close()
    await h.stopEnv()
  }
  h.finish()
}
main().catch(e => { console.error(e); process.exit(1) })
