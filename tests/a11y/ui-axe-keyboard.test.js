// Browser: axe on every page and artifact state in the authoring and learner views, keyboard-only runs, focus, reflow, motion, targets
// Run by `npm run test:a11y`. Uses a mock AI model and a throwaway HOME.
const h = require('./support/ui-harness')
const { APP, KC, L, MOCK, P, PRIMARY, api, check, draftViaApi, launchBrowser, setMode, startEnv, stopEnv } = h
const { AxeBuilder } = require('@axe-core/playwright')
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
const lum = h => { const [r, g, b] = hex(h).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }

async function main() {
  await h.startEnv({ ui: true })
  await api('GET', '/projects')
  await api('POST', '/settings', { provider: 'local', model: 'm', baseUrl: `${MOCK}/v1` })
  const GEN = `/projects/${P}/sources/${PRIMARY}/artifacts/generate`
  for (const t of ['flip-card-deck', 'knowledge-check', 'scenario-branching']) await api('POST', GEN, { artifactType: t })
  const ref = async t => (await api('GET', `/projects/${P}/artifacts?type=${t}`)).data[0]
  const refs = { 'flip-card-deck': await ref('flip-card-deck'), 'knowledge-check': await ref('knowledge-check'), 'scenario-branching': await ref('scenario-branching') }
  const lessonOf = async id => (await api('GET', `${L}/${id}`)).data.lesson
  const fill = async id => {
    for (const [type, r] of Object.entries(refs)) {
      const b = (await lessonOf(id)).blocks.find(x => x.artifact_type === type && x.state === 'proposed')
      if (b) await api('POST', `${L}/${id}/blocks/${b.id}/artifact`, { mode: 'existing', source: r.source, artifact: r.folder })
    }
  }
  const dr = await draftViaApi({}, { withTabs: true })
  await fill(dr)
  let les = await lessonOf(dr)
  const tb = les.blocks.find(b => b.kind === 'tabs')
  await api('PUT', `${L}/${dr}/blocks/${tb.id}/tabs`, { title: 'Roles compared', tabs: [{ label: 'Host', body: 'Host body.', visual: 'A diagram of the host.', alt_text: 'The host listens for requests.', long_description: 'The host is one box. It has two ports.' }, { label: 'Client', body: 'Client body.' }] })
  const ch = les.blocks.filter(b => b.kind === 'chunk')
  await api('PUT', `${L}/${dr}/blocks/${ch[0].id}/text`, { title: ch[0].title, body: ch[0].body, visual: ch[0].visual, alt_text: 'A matrix of changeover times.', long_description: 'Rows are products. Columns are products. Each cell is minutes.' })
  await api('PUT', `${L}/${dr}/blocks/${ch[1].id}/text`, { title: ch[1].title, body: ch[1].body, visual: ch[1].visual, decorative: true, decorative_reason: 'Spacer' })
  // a budget-5 lesson with proposals to push over budget by hand
  const small = await draftViaApi({ timeBudgetMinutes: 5 })
  const bp = (await api('POST', L, { topic: 'Blueprint stage', sources: [PRIMARY] })).data.lesson.id
  await api('POST', `${L}/${bp}/blueprint/generate`)
  const ap = (await api('POST', L, { topic: 'Approved stage', sources: [PRIMARY] })).data.lesson.id
  await api('POST', `${L}/${ap}/blueprint/generate`); await api('PUT', `${L}/${ap}/blueprint`, { approve: true })
  const browser = await h.launchBrowser()
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1100 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(m.text()) })
  const base = `${APP}/projects/${P}`
  const go = async u => { await page.goto(u); await page.waitForTimeout(500) }
  const AUTH = `${base}/lessons/${dr}`, PREV = `${base}/lessons/${dr}/preview`
  const scanned = []
  let aaa = 0
  const scan = async (state) => {
    const r = await new AxeBuilder({ page }).withTags(WCAG).analyze()
    scanned.push(state)
    check(`axe 0 violations (WCAG 2.2 AA): ${state}`, r.violations.length === 0, r.violations.map(v => `${v.id} ${v.nodes[0].target.join(' ')} ${(v.nodes[0].failureSummary || '').split('\n')[1] || ''}`))
    const e = await new AxeBuilder({ page }).withRules(['color-contrast-enhanced']).analyze()
    aaa += e.violations.reduce((n, v) => n + v.nodes.length, 0)
  }

  try {
    console.log('=== PAGES (axe, WCAG 2.2 AA) ===')
    for (const [name, u] of Object.entries({ projects: APP + '/', settings: APP + '/settings', project: base, 'add source': base + '/sources/new', source: `${base}/sources/${PRIMARY}`, 'new lesson': base + '/lessons/new', 'lesson blueprint stage': `${base}/lessons/${bp}`, 'lesson approved stage': `${base}/lessons/${ap}` })) {
      await go(u); await scan('page: ' + name)
    }
    await go(`${base}/sources/${PRIMARY}`)
    const items = await page.$$('.artifact-item')
    check('source page lists artifacts as real buttons', items.length >= 3 && (await page.$$eval('.artifact-item', e => e.every(x => x.tagName === 'BUTTON'))))
    for (let i = 0; i < items.length; i++) { await page.locator('.artifact-item').nth(i).click(); await page.waitForTimeout(250); await scan('source page artifact #' + i) }
    await go(APP + '/'); await page.click('text=+ New project'); await scan('projects: new-project form open')

    console.log('=== AUTHORING LESSON PAGE ===')
    await go(AUTH); await scan('authoring: initial')
    await page.locator('[aria-hidden="false"] .flipcard-flip').first().click(); await page.waitForTimeout(500); await scan('authoring: flip card flipped')
    const kcA = page.locator('.lesson-artifact:has(.kc)'); await kcA.locator('.kc-option').first().click(); await scan('authoring: KC answered')
    const scA = page.locator('.lesson-artifact:has(.scenario)'); await scA.locator('.scenario-choice').first().click(); await scan('authoring: scenario feedback')
    await go(AUTH)
    const chunk = page.locator('.lesson-block-chunk').first()
    await chunk.locator('button:has-text("Edit")').click(); await scan('authoring: chunk editor'); await chunk.locator('button:has-text("Cancel")').click()
    await chunk.locator('button:has-text("Regenerate")').click(); await scan('authoring: context panel'); await chunk.locator('.context-panel button:has-text("Cancel")').click()
    await chunk.locator('button:has-text("Remove")').click(); await scan('authoring: remove confirmation'); await chunk.locator('button:has-text("Cancel")').click()
    const tabsB = page.locator('.lesson-tabs-block').first()
    await tabsB.locator('button:has-text("Edit")').click(); await scan('authoring: tabs editor'); await tabsB.locator('button:has-text("Cancel")').click()
    await page.locator('button:has-text("+ Insert here")').first().click(); await scan('authoring: insert menu')
    setMode('notjson')
    await page.locator('.insert-control button:text-is("Chunk")').click(); await page.locator('button:has-text("Generate...")').click()
    await page.locator('.insert-flow .context-panel button:has-text("Generate")').click(); await page.waitForSelector('.error-state'); setMode('ok')
    await scan('authoring: error state')

    console.log('=== LEARNER PREVIEW ===')
    await go(PREV); await scan('preview: initial')
    const flip = page.locator('.flipcard-deck')
    await flip.locator('[aria-hidden="false"] .flipcard-flip').click(); await page.waitForTimeout(500); await scan('preview: flip card flipped')
    await flip.locator('[aria-hidden="false"] .flipcard-flip').click(); await page.waitForTimeout(500)
    await flip.locator('button:has-text("Next card")').click(); await page.waitForTimeout(500); await scan('preview: flip card 2 front')
    const kc = page.locator('.lesson-artifact:has(.kc)')
    await scan('preview: KC unanswered')
    await kc.locator('.kc-option').first().click(); await scan('preview: KC answered')
    for (let i = 0; i < 3; i++) { await kc.locator('.kc-actions .btn').click(); await page.waitForTimeout(200); if (i < 2) await kc.locator('.kc-option').first().click() }
    await scan('preview: KC summary')
    const sc = page.locator('.lesson-artifact:has(.scenario)')
    await scan('preview: scenario node 1')
    await sc.locator('.scenario-choice').first().click(); await scan('preview: scenario node 1 feedback')
    await sc.locator('.scenario-actions .btn-primary').click(); await page.waitForTimeout(200); await scan('preview: scenario node 2')
    await sc.locator('.scenario-choice').nth(1).click(); await sc.locator('.scenario-actions .btn-primary').click(); await page.waitForTimeout(200); await scan('preview: scenario ending')
    await page.locator('.lesson-tabs button[role=tab]').nth(0).click()
    await page.locator('.lesson-tabs button:has-text("Describe this visual")').first().click(); await scan('preview: tab 1 with long description open')
    await page.locator('.lesson-tabs button[role=tab]').nth(1).click(); await scan('preview: tab 2')
    await page.locator('button:has-text("Show answer")').first().click(); await scan('preview: recall answer shown')

    console.log('=== LEARNER PREVIEW HIDES AUTHORING ===')
    await go(PREV)
    const text = await page.locator('main').innerText()
    for (const bad of ['Generated with', 'Brief for the author', 'No alt text yet', 'Regenerate', 'Insert here', 'Move up', 'Move down', 'of 10 min', 'Edited by you', 'Suggested:']) {
      check(`preview does not show "${bad}"`, !text.includes(bad))
    }
    check('preview has no Edit/Remove/Replace/Pick/Generate buttons', (await page.locator('main button').allTextContents()).every(t => !/^(Edit|Remove|Replace|Pick|Generate)/.test(t.trim())))
    check('preview has no time meter and no author header', !(await page.locator('.time-meter, .app-header').count()))
    check('learners see the alt text, never the brief', text.includes('A matrix of changeover times.') && !text.includes('VISUAL-2'))
    check('a decorative visual is left out entirely', !text.includes('Spacer') && !text.includes('VISUAL-3'))
    check('"Describe this visual" is offered where there is a long description', await page.locator('button:has-text("Describe this visual")').count() >= 1)
    const h = await page.$$eval('main h1, main h2, main h3', e => e.map(x => x.tagName + ':' + x.textContent.trim().slice(0, 30)))
    check('"How to use this lesson" is the first section after the title', h[0].startsWith('H1') && h[1] === 'H2:How to use this lesson', h)
    const how = await page.locator('#how-to-use').locator('xpath=..').innerText()
    check('the note covers flip cards, tabs, scenarios and knowledge checks, and says there is no time limit', /Flip cards/.test(how) && /Tabs/.test(how) && /Scenarios and knowledge checks/.test(how) && /no time limit/.test(how))
    check('"Back to editing" is the only authoring chrome', await page.locator('.preview-bar a:has-text("Back to editing")').isVisible())
    await page.locator('.preview-bar a').click(); await page.waitForSelector('.lesson-blocks')
    check('Back to editing returns to the authoring page', page.url().endsWith(`/lessons/${dr}`) && await page.locator('a:has-text("Preview as learner")').isVisible())

    console.log('=== KEYBOARD ONLY: SKIP LINK, FLIP, KC, SCENARIO, TABS ===')
    await go(base)
    await page.keyboard.press('Tab')
    check('the first Tab stop is the skip link', (await page.evaluate(() => document.activeElement.textContent)) === 'Skip to main content' && await page.locator('.skip-link').isVisible())
    await page.keyboard.press('Enter')
    check('Enter moves focus to the main content', await page.evaluate(() => document.activeElement.id === 'main'))

    await go(PREV)
    const press = async (key, n = 1) => { for (let i = 0; i < n; i++) await page.keyboard.press(key) }
    const focusIn = async sel => { for (let i = 0; i < 200; i++) { await page.keyboard.press('Tab'); if (await page.evaluate(s => !!document.activeElement.closest(s), sel)) return true } return false }
    const activeText = () => page.evaluate(() => (document.activeElement.getAttribute('aria-label') || document.activeElement.textContent || '').trim())
    check('Tab reaches the Reveal answer button', await focusIn('.flipcard-deck') && (await activeText()) === 'Reveal answer')
    check('the hidden face is out of the accessibility tree before the flip (aria-hidden + inert on the back)', await page.evaluate(() => { const b = document.querySelector('.flipcard-back'); return b.getAttribute('aria-hidden') === 'true' && b.hasAttribute('inert') }))
    check('the answer is not in the accessibility snapshot before the flip', !(await page.locator('.flipcard-deck').ariaSnapshot()).includes('back 1'))
    await press('Enter'); await page.waitForTimeout(400)
    check('Enter flips the card; focus moves to Show question', (await activeText()) === 'Show question')
    check('the live region announces the answer', /^Answer\. back 1/.test(await page.locator('.flipcard-deck [role=status]').textContent()))
    check('now the front is hidden and the back is exposed', await page.evaluate(() => document.querySelector('.flipcard-front').getAttribute('aria-hidden') === 'true' && document.querySelector('.flipcard-back').getAttribute('aria-hidden') === 'false'))
    await press('Space'); await page.waitForTimeout(400)
    check('Space flips back; focus returns to Reveal answer', (await activeText()) === 'Reveal answer' && /^Question\./.test(await page.locator('.flipcard-deck [role=status]').textContent()))
    await press('ArrowRight'); await page.waitForTimeout(500)
    check('the right arrow key moves to card 2 and announces it', /Card 2 of 4/.test(await page.locator('.flipcard-deck [role=status]').textContent()))
    await press('Tab'); await press('Tab')
    check('Tab order after the card: Previous card, then the card buttons', /Previous card|Card 1 of 4/.test(await activeText()))
    const dots = await page.$$eval('.flipcard-dot', e => e.map(x => ({ w: x.getBoundingClientRect().width, h: x.getBoundingClientRect().height, label: x.getAttribute('aria-label'), cur: x.getAttribute('aria-current') })))
    check('the card buttons are 24x24 or larger and name their position', dots.length === 4 && dots.every(d => d.w >= 24 && d.h >= 24 && /^Card \d of 4$/.test(d.label)))
    check('the current card is marked with aria-current', dots.filter(d => d.cur === 'true').length === 1)

    // KC by keyboard
    check('Tab reaches the first knowledge check option', await focusIn('.kc-options'))
    await press('Enter'); await page.waitForTimeout(200)
    check('choosing by Enter shows the feedback with a text label (not color alone)', /Strongest answer|A weaker answer/.test(await page.locator('.kc-feedback').textContent()))
    check('focus lands on the Next button', /Next question|See results/.test(await activeText()))
    check('feedback sits in a live region', await page.locator('.kc [aria-live=polite]').count() >= 1)
    await press('Enter'); await page.waitForTimeout(200)
    check('after Next, focus moves to the new question counter', await page.evaluate(() => document.activeElement.className === 'kc-progress') && /Question 2 of 3/.test(await activeText()))
    await press('Tab'); await press('Enter'); await press('Enter'); await page.waitForTimeout(200)
    await press('Tab'); await press('Enter'); await press('Enter'); await page.waitForTimeout(200)
    check('the results page takes focus', (await activeText()) === 'Your results')
    check('the summary labels every answer in words', (await page.locator('.kc-badge').allTextContents()).every(t => /Strongest answer|A weaker answer/.test(t)))
    await press('Tab'); await press('Enter'); await page.waitForTimeout(200)
    check('"Try again from the start" restarts without a page reload', /Question 1 of 3/.test(await activeText()))

    // scenario by keyboard
    check('Tab reaches the first scenario option', await focusIn('.scenario-choices'))
    await press('Enter'); await page.waitForTimeout(200)
    check('feedback names its quality in words; focus is on Continue', /Strongest choice|A weaker choice|Best|Weak|choice|option/i.test(await page.locator('.scenario-feedback').textContent()) && /Continue|Next|See/.test(await activeText()), await activeText())
    await press('Tab'); await press('Enter'); await page.waitForTimeout(200)
    check('"Try a different choice" puts focus back on the first option', await page.evaluate(() => document.activeElement.classList.contains('scenario-choice') && !document.activeElement.disabled))
    await press('Enter'); await page.waitForTimeout(200)
    check('choosing again lands on Continue', /Continue/.test(await activeText()))
    await press('Enter'); await page.waitForTimeout(200)
    check('after Continue, focus moves to the new decision', /Decision 2/.test(await activeText()))
    await press('Tab'); await press('Enter'); await press('Enter'); await page.waitForTimeout(200)
    check('the ending takes focus', (await activeText()) === 'How it played out')
    check('the summary labels every choice in words', (await page.locator('.scenario-badge').allTextContents()).every(t => t.trim().length > 3))
    await press('Tab'); await press('Enter'); await page.waitForTimeout(200)
    check('"Try again from the start" restarts the scenario without a reload', /Decision 1/.test(await activeText()))

    // tabs + disclosure by keyboard
    check('Tab reaches the tab list once (roving tabindex)', await focusIn('.lesson-tabs-list'))
    await press('ArrowRight')
    check('the right arrow selects the next tab', (await page.locator('.lesson-tabs [role=tab][aria-selected=true]').textContent()) === 'Client')
    await press('ArrowLeft')
    await press('Tab'); 
    check('Tab leaves the list for the tab panel', await page.evaluate(() => document.activeElement.getAttribute('role') === 'tabpanel'))
    await press('Tab')
    check('then the "Describe this visual" button', (await activeText()) === 'Describe this visual')
    await press('Enter')
    check('Enter opens the long description', await page.evaluate(() => document.activeElement.getAttribute('aria-expanded') === 'true'))

    console.log('=== KEYBOARD ONLY: LESSON EDITOR ===')
    await go(AUTH)
    await page.keyboard.press('Tab'); await page.keyboard.press('Enter')   // skip link
    check('every block button has a unique name (no two buttons announce the same)', await (async () => {
      const names = await page.$$eval('main button', e => e.map(b => (b.getAttribute('aria-label') || b.textContent).trim()).filter(Boolean))
      const dup = names.filter((n, i) => names.indexOf(n) !== i)
      return dup.length === 0 ? true : dup
    })())
    const editBtn = page.getByRole('button', { name: /^Edit chunk: / }).first()
    await editBtn.focus(); await page.keyboard.press('Enter')
    check('Enter on Edit opens the editor and focus lands in its first field', await page.evaluate(() => document.activeElement.closest('form') !== null && document.activeElement.tagName === 'INPUT'))
    await page.keyboard.type(' (kb)')
    for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); if ((await activeText()) === 'Save') break }
    check('Tab reaches Save', (await activeText()) === 'Save')
    await page.keyboard.press('Enter'); await page.waitForTimeout(800)
    check('saving by keyboard works and focus returns to the Edit button', /^Edit chunk: .*\(kb\)/.test(await activeText()), await activeText())
    await page.getByRole('button', { name: /^Remove chunk: / }).first().focus(); await page.keyboard.press('Enter')
    check('Remove asks for confirmation (a named group)', await page.getByRole('group', { name: /^Confirm removing chunk/ }).isVisible())
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab')
    check('Tab reaches "Cancel, keep ..."', /^Cancel, keep chunk/.test(await activeText()))
    await page.keyboard.press('Enter')
    check('Cancel returns focus to Remove', /^Remove chunk: /.test(await activeText()))
    const moveDown = page.getByRole('button', { name: /^Move the chunk .* down$/ }).first()
    await moveDown.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(700)
    check('Move down by keyboard keeps focus and announces', /Move the chunk/.test(await activeText()) && /Moved the chunk/.test(await page.locator('[role=status]:has-text("Moved")').textContent()))
    const ins = page.getByRole('button', { name: /^Insert here, after hook/ })
    await ins.focus(); await page.keyboard.press('Enter')
    check('Insert here opens a menu and focus moves into it', (await activeText()) === 'Tabs block')
    await page.keyboard.press('Escape').catch(() => {})
    for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); if ((await activeText()) === 'Cancel') break }
    await page.keyboard.press('Enter')
    check('Cancel returns focus to Insert here', /^Insert here, after hook/.test(await activeText()))
    await page.getByRole('button', { name: /^Regenerate chunk: / }).first().focus(); await page.keyboard.press('Enter')
    check('Regenerate opens the panel with focus in its first field', await page.evaluate(() => document.activeElement.closest('.context-panel') !== null))
    await page.keyboard.press('Shift+Tab').catch(() => {})
    await page.locator('.context-panel button:has-text("Cancel")').focus(); await page.keyboard.press('Enter')
    check('Cancel returns focus to Regenerate', /^Regenerate chunk: /.test(await activeText()))

    console.log('=== FOCUS NEVER HIDDEN BEHIND STICKY UI (2.4.11) ===')
    for (const [name, url, startBottom] of [['authoring', AUTH, false], ['authoring (Shift+Tab from the bottom)', AUTH, true], ['preview', PREV, false]]) {
      await go(url)
      if (startBottom) { await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); document.body.focus() }) }
      let hidden = [], stops = 0
      for (let i = 0; i < 160; i++) {
        await page.keyboard.press(startBottom ? 'Shift+Tab' : 'Tab')
        const r = await page.evaluate(() => {
          const el = document.activeElement; if (!el || el === document.body) return null
          const b = el.getBoundingClientRect()
          const stuck = [...document.querySelectorAll('.app-header, .time-meter')].map(s => s.getBoundingClientRect()).filter(s => s.height)
          const under = stuck.some(s => b.top < s.bottom - 1 && b.bottom > s.top + 1 && !el.closest('.time-meter, .app-header'))
          return { under: under && !el.classList.contains('skip-link'), label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30) }
        })
        if (!r) continue
        stops++; if (r.under) hidden.push(r.label)
      }
      check(`${name}: ${stops} focus stops, none under the sticky header or meter`, stops > 20 && hidden.length === 0, hidden.slice(0, 5))
    }

    console.log('=== TIME METER ===')
    await go(AUTH)
    check('the meter is not a live region and not role=status', !(await page.locator('.time-meter[role=status], .time-meter[aria-live]').count()))
    const bar = page.locator('.time-meter-bar')
    check('the bar has a name and a text value', /Lesson time estimate/.test(await bar.getAttribute('aria-label')) && /\d+(\.\d)? of 10 minutes/.test(await bar.getAttribute('aria-valuetext')))
    check('it says it is an estimate for authors (name), and there is no learner time limit', /for authors/.test(await bar.getAttribute('aria-label')))
    const SM = `${base}/lessons/${small}`
    await go(SM)
    const live = page.locator('.time-meter [role=status]')
    check('the announcement region starts empty', (await live.textContent()) === '')
    // start from text only (under budget), then add artifacts through the keyboard-reachable UI
    for (const b of (await lessonOf(small)).blocks.filter(x => x.kind === 'artifact')) await api('DELETE', `${L}/${small}/blocks/${b.id}`)
    await go(SM)
    const addExisting = async type => {
      await page.getByRole('button', { name: /^Insert here, after hook/ }).click()
      await page.locator(`.insert-control button:text-is("${type}")`).click()
      await page.locator('.insert-control button:has-text("Pick existing")').click()
      await page.locator('.picker-item button:has-text("Use this")').first().click()
      await page.waitForTimeout(600)
    }
    await addExisting('Flip Card Deck')
    check('still under budget: nothing is announced', (await live.textContent()) === '' && !(await page.locator('.time-meter-warning').count()), await live.textContent())
    await addExisting('Knowledge Check')
    check('going over budget is announced politely', /The lesson is now over its time budget: \d+(\.\d)? of 5 minutes\./.test(await live.textContent()), await live.textContent())
    check('the visible warning is shown too', await page.locator('.time-meter-warning').isVisible())
    await page.getByRole('button', { name: /^Remove knowledge check/ }).first().click()
    await page.getByRole('button', { name: /^Yes, remove/ }).click(); await page.waitForTimeout(600)
    check('coming back under budget is announced', /back within its time budget/.test(await live.textContent()), await live.textContent())
    check('removing a block announces it and moves focus to the page title', /^Removed /.test(await page.locator('[role=status]:has-text("Removed")').textContent()) && await page.evaluate(() => document.activeElement.tagName === 'H1'))

    console.log('=== REFLOW, SPACING, MOTION, TARGETS ===')
    for (const [name, url] of [['projects', APP + '/'], ['source', `${base}/sources/${PRIMARY}`], ['authoring lesson', AUTH], ['learner preview', PREV], ['blueprint editor', `${base}/lessons/${bp}`], ['settings', APP + '/settings']]) {
      await page.setViewportSize({ width: 320, height: 700 }); await go(url)
      const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
      check(`no horizontal scroll at 320 CSS px (400% zoom): ${name}`, w.sw <= w.cw + 1, w)
      await page.setViewportSize({ width: 1200, height: 1100 })
    }
    for (const [name, url] of [['authoring lesson', AUTH], ['learner preview', PREV]]) {
      await go(url)
      await page.addStyleTag({ content: '*{line-height:1.5 !important;letter-spacing:.12em !important;word-spacing:.16em !important} p{margin-bottom:2em !important}' })
      await page.waitForTimeout(200)
      const bad = await page.evaluate(() => ({
        clipped: [...document.querySelectorAll('main *')].filter(e => { const cs = getComputedStyle(e); return (cs.overflow === 'hidden' || cs.overflowY === 'hidden') && e.scrollHeight > e.clientHeight + 2 && e.clientHeight > 0 && e.tagName !== 'TEXTAREA' && !e.classList.contains('sr-only') && !e.hasAttribute('hidden') }).map(e => e.className).slice(0, 3),
        hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 }))
      check(`text spacing overrides do not clip or scroll: ${name}`, bad.clipped.length === 0 && !bad.hscroll, bad)
    }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await go(PREV)
    const motion = await page.evaluate(() => { const d = n => parseFloat(getComputedStyle(document.querySelector(n)).transitionDuration) * 1000; return { flip: d('.flipcard-inner'), fill: 0 } })
    check('prefers-reduced-motion: the flip transition is effectively off (<= 0.01 ms)', motion.flip <= 0.011, motion)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await go(PREV)
    check('without the preference the flip still animates (0.45 s)', await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.flipcard-inner')).transitionDuration) === 0.45))
    for (const [name, url] of [['authoring', AUTH], ['preview', PREV], ['source', `${base}/sources/${PRIMARY}`]]) {
      await go(url)
      const small = await page.evaluate(() => [...document.querySelectorAll('button, input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea, [role=tab]')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[hidden]') && (r.width < 24 || r.height < 24) }).map(e => `${e.tagName}.${e.className} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`))
      check(`every button and field is at least 24x24: ${name}`, small.length === 0, small.slice(0, 4))
    }

    console.log('=== CONTRAST TOKENS ===')
    const tok = await page.evaluate(() => { const cs = getComputedStyle(document.documentElement); const g = n => cs.getPropertyValue(n).trim(); return { sec: g('--color-text-secondary'), mut: g('--color-text-muted'), brd: g('--color-border-strong'), acc: g('--color-accent'), ok: g('--color-success'), err: g('--color-error') } })
    const grounds = ['#ffffff', '#f8f7f4', '#eef2ff', '#fffbeb']
    check('secondary text is 7:1 or better on every background (AAA)', grounds.every(g => ratio(tok.sec, g) >= 6.95), grounds.map(g => ratio(tok.sec, g).toFixed(2)))
    check('muted text is 4.5:1 or better on every background', grounds.every(g => ratio(tok.mut, g) >= 4.5))
    check('control and card borders are 3:1 or better against white, the page and the accent tint', grounds.slice(0, 3).every(g => ratio(tok.brd, g) >= 3))
    check('the focus ring colour is 3:1 or better on white and the page', ratio(tok.acc, '#ffffff') >= 3 && ratio(tok.acc, '#f8f7f4') >= 3)
    check('success and error text are 4.5:1 or better on every background', grounds.every(g => ratio(tok.ok, g) >= 4.5 && ratio(tok.err, g) >= 4.5))
    check('the keyboard focus indicator is a 3px outline on a real button', await (async () => { await go(PREV); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); return page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return parseFloat(cs.outlineWidth) >= 3 && cs.outlineStyle === 'solid' }) })())

    console.log('=== TITLES, HEADINGS, LANGUAGE, STATUS MESSAGES ===')
    const titles = {}
    for (const [name, url] of Object.entries({ projects: APP + '/', settings: APP + '/settings', project: base, 'add source': base + '/sources/new', source: `${base}/sources/${PRIMARY}`, 'new lesson': base + '/lessons/new', lesson: AUTH, preview: PREV })) {
      await go(url); titles[name] = await page.title()
      const hs = await page.$$eval('h1, h2, h3, h4, h5, h6', e => e.map(x => Number(x.tagName[1])))
      check(`headings never skip a level, one h1: ${name}`, hs.filter(n => n === 1).length === 1 && hs.every((n, i) => i === 0 || n <= hs[i - 1] + 1), hs)
    }
    check('every page has its own title ending in "— Byte"', new Set(Object.values(titles)).size === Object.keys(titles).length && Object.values(titles).every(t => /— Byte$/.test(t)), titles)
    check('the page language is set', (await page.evaluate(() => document.documentElement.lang)) === 'en')
    await go(base)
    const saveBtn = page.locator('button:has-text("Save")').first()
    await saveBtn.click(); await page.waitForTimeout(800)
    check('a save is announced in a live region', /saved\./.test(await page.locator('[role=status]:has-text("saved")').first().textContent()))
    await page.waitForTimeout(3500)
    check('"Saved ✓" is still showing after 4 seconds (long enough to read)', await page.locator('button:has-text("Saved ✓")').count() >= 1)
    await go(APP + '/settings')
    const k = page.locator('input[type=password]'); if (await k.count()) { await page.locator('select').first().selectOption({ index: 0 }).catch(() => {}) }
    check('the Settings success message sits in a role=status container', (await page.locator('[role=status]').count()) >= 1)

    console.log('=== SUMMARY ===')
    console.log(`axe states scanned: ${scanned.length}; AAA enhanced-contrast nodes still below 7:1 (informational): ${aaa}`)
    check('no page errors', errors.length === 0, errors)
  } finally {
    await browser.close(); await h.stopEnv()
  }
  h.finish()
}
main().catch(e => { console.error(e); process.exit(1) })
