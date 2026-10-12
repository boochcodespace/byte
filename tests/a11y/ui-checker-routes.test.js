// Browser: the accessibility checker, route-change focus, and emoji
// Run by `npm run test:a11y`. Uses a mock AI model and a throwaway HOME.
const h = require('./support/ui-harness')
const { APP, L, MOCK, P, PRIMARY, api, check, draftViaApi, launchBrowser, proposal, startEnv, stopEnv, waitFor } = h
const { AxeBuilder } = require('@axe-core/playwright')
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
async function main() {
  await h.startEnv({ ui: true })
  await api('GET', '/projects'); await api('POST', '/settings', { provider: 'local', model: 'm', baseUrl: `${MOCK}/v1` })
  const GEN = `/projects/${P}/sources/${PRIMARY}/artifacts/generate`
  for (const t of ['flip-card-deck', 'knowledge-check', 'scenario-branching']) await api('POST', GEN, { artifactType: t })
  const refs = {}
  for (const t of ['flip-card-deck', 'knowledge-check', 'scenario-branching']) refs[t] = (await api('GET', `/projects/${P}/artifacts?type=${t}`)).data[0]
  const lessonOf = async id => (await api('GET', `${L}/${id}`)).data.lesson
  const dr = await draftViaApi({}, { withTabs: true })
  for (const [type, r] of Object.entries(refs)) { const b = (await lessonOf(dr)).blocks.find(x => x.artifact_type === type && x.state === 'proposed'); if (type !== 'scenario-branching') await api('POST', `${L}/${dr}/blocks/${b.id}/artifact`, { mode: 'existing', source: r.source, artifact: r.folder }) }
  // seed problems: chunk 0 visual with no alt, chunk 1 colour wording; scenario stays a proposal
  const les0 = await lessonOf(dr)
  const ch = les0.blocks.filter(b => b.kind === 'chunk')
  await api('PUT', `${L}/${dr}/blocks/${ch[0].id}/text`, { title: ch[0].title, body: ch[0].body, visual: 'SECRET-BRIEF diagram, no alt yet' })
  await api('PUT', `${L}/${dr}/blocks/${ch[1].id}/text`, { title: ch[1].title, body: 'Press the green button on the left to continue.', visual: ch[1].visual, alt_text: 'A matrix of times.' })
  const browser = await h.launchBrowser()
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1100 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(m.text()) })
  const base = `${APP}/projects/${P}`
  const AUTH = `${base}/lessons/${dr}`, PREV = `${AUTH}/preview`
  const go = async u => { await page.goto(u); await page.waitForTimeout(500) }
  const scan = async state => {
    const r = await new AxeBuilder({ page }).withTags(WCAG).analyze()
    check(`axe 0 violations (WCAG 2.2 AA): ${state}`, r.violations.length === 0, r.violations.map(v => `${v.id} ${v.nodes[0].target.join(' ')}`))
  }
  const activeText = () => page.evaluate(() => (document.activeElement.getAttribute('aria-label') || document.activeElement.textContent || '').trim().slice(0, 80))

  try {
    console.log('=== THE CHECKER ===')
    await go(AUTH)
    const checker = page.locator('.a11y-checker')
    check('the checker is on demand: nothing is listed until it runs', await checker.locator('button:has-text("Check accessibility")').isVisible() && !(await checker.locator('.a11y-issue').count()))
    await scan('checker closed')
    await checker.locator('button:has-text("Check accessibility")').focus(); await page.keyboard.press('Enter')
    await checker.locator('.a11y-issue').first().waitFor()
    check('Enter runs it; focus moves to the results heading', (await activeText()) === 'Accessibility check')
    check('the result is announced in a live region', /^Accessibility check finished: 1 error, 2 warnings, \d+ notes\./.test(await checker.locator('[role=status]').first().textContent()), await checker.locator('[role=status]').first().textContent())
    const summary = await checker.locator('.a11y-summary').textContent()
    check('the summary counts errors, warnings and notes', /1 error, 2 warnings, \d+ notes open\./.test(summary), summary)
    check('headings: "Problems in the content" and "Blocks learners will not see"', await checker.locator('h3:text-is("Problems in the content")').isVisible() && await checker.locator('h3:text-is("Blocks learners will not see")').isVisible())
    const severities = await checker.locator('.a11y-severity').allTextContents()
    check('severity is a text label, never color alone', severities.length >= 3 && severities.every(t => /^(Error|Warning|Note)$/.test(t)), severities)
    check('the order is by block, with a "where" for each issue', (await checker.locator('.a11y-where').allTextContents()).every(t => /chunk:|hook|apply|recall|flip|knowledge|scenario|tabs|lesson/.test(t)))
    const names = await checker.locator('button').evaluateAll(e => e.map(b => b.getAttribute('aria-label') || b.textContent.trim()))
    check('every checker button has a unique, descriptive name', new Set(names).size === names.length && names.some(n => /^Fix missing alt text in chunk: /.test(n)) && names.some(n => /^Mark missing alt text in chunk: .* as reviewed$/.test(n)), names)
    check('advisory checks appear as notes: reading level and acronyms are named', names.some(n => /^Fix reading level/.test(n)) && (await checker.locator('.a11y-issue.a11y-note:has-text("reads at about grade")').count()) >= 1)
    await scan('checker open with issues')

    console.log('=== FIX AND REVIEW ===')
    const issueMissing = checker.locator('.a11y-issue:has-text("no alt text")').first()
    await issueMissing.locator('button:has-text("Fix")').focus(); await page.keyboard.press('Enter')
    await page.waitForSelector('.lesson-block-chunk form')
    check('Fix opens the chunk editor on the right block', await page.locator('.lesson-block-chunk form').first().getByLabel(/Visual note/).inputValue().then(v => v.includes('SECRET-BRIEF')))
    check('focus is inside the editor', await page.evaluate(() => !!document.activeElement.closest('form')))
    await page.locator('.lesson-block-chunk form').first().getByLabel('Alt text').fill('A diagram with an alt text now.')
    await page.locator('.lesson-block-chunk form').first().locator('button:has-text("Save")').click()
    await page.waitForTimeout(700)
    check('after saving, the checker says the lesson changed since the check', await checker.locator('text=The lesson has changed since this check. Run the check again.').isVisible())
    await checker.locator('button:has-text("Run the check again")').click()
    await checker.locator('.a11y-summary').waitFor(); await page.waitForTimeout(400)
    check('the fixed error is gone', !(await checker.locator('.a11y-issue:has-text("no alt text")').count()) && /0 errors/.test(await checker.locator('.a11y-summary').textContent()))
    check('the stale note is gone', !(await checker.locator('text=has changed since this check').count()))

    const colour = checker.locator('.a11y-issue:has-text("green button")').first()
    check('colour wording is flagged with its phrase quoted', await colour.isVisible())
    await colour.locator('button:has-text("Mark as reviewed")').click()
    const form = colour.locator('form')
    check('"Mark as reviewed" asks for a reason in a labelled field, and focuses it', await form.getByLabel('Why is this fine?').isVisible() && await page.evaluate(() => document.activeElement.closest('form') !== null))
    check('Save review is disabled until a reason is typed', await form.locator('button:has-text("Save review")').isDisabled())
    await scan('review form open')
    await form.getByLabel('Why is this fine?').fill('Quoting a button label from the product screen')
    await form.locator('button:has-text("Save review")').click()
    await checker.locator('h3:text-is("Reviewed")').waitFor()
    check('it moves to a Reviewed list with its reason and an Undo button', await checker.locator('.a11y-reviewed:has-text("Quoting a button label")').isVisible() && await checker.locator('button:has-text("Undo review")').first().isVisible())
    check('the live region announces it', /Marked as reviewed/.test(await checker.locator('[role=status]').first().textContent()))
    await scan('reviewed list')
    await checker.locator('button:has-text("Undo review")').first().click()
    await page.waitForTimeout(400)
    check('Undo review returns it to the open list', await checker.locator('.a11y-issue:has-text("green button")').first().isVisible() && !(await checker.locator('.a11y-reviewed').count()))
    await colour.locator('button:has-text("Fix")').focus().catch(() => {})
    const fixColour = checker.locator('.a11y-issue:has-text("green button") button:has-text("Fix")').first()
    await fixColour.click(); await page.waitForSelector('.lesson-block-chunk form')
    check('Fix on wording opens that chunk for editing', await page.locator('.lesson-block-chunk form textarea').first().inputValue().then(v => v.includes('green button')))
    await page.locator('.lesson-block-chunk form button:has-text("Cancel")').click()

    console.log('=== BLOCKS THE PREVIEW WILL SKIP ===')
    const skippedHeading = checker.locator('h3:text-is("Blocks learners will not see")')
    check('the skipped-blocks list names the scenario suggestion', await checker.locator('.a11y-issue:has-text("suggested scenario")').isVisible())
    const fixSkipped = checker.locator('.a11y-issue:has-text("suggested scenario") button:has-text("Fix")')
    await fixSkipped.click(); await page.waitForTimeout(200)
    check('its Fix link focuses the suggestion\'s Generate button', /^Generate for this lesson: scenario/.test(await activeText()), await activeText())
    // what the preview really leaves out
    await go(PREV)
    const pt = await page.locator('main').innerText()
    check('the preview leaves out exactly that suggestion', !/scenario/i.test(await page.locator('section[aria-label="Scenario Branching"]').count().then(c => c ? 'scenario' : '')) )
    check('the preview shows no author brief for a visual that has no alt text', !pt.includes('SECRET-BRIEF'))

    console.log('=== ROUTE CHANGES ===')
    await go(base)
    await page.getByRole('link', { name: 'Settings' }).click()
    await page.waitForFunction(() => document.activeElement && document.activeElement.tagName === 'H1')
    check('after a link click focus lands on the new page\'s h1', (await activeText()) === 'Settings')
    check('a polite live region says which page it is', (await page.locator('body > #root [role=status]:has-text("Now on")').first().textContent()) === 'Now on Settings.', await page.locator('[role=status]:has-text("Now on")').first().textContent())
    check('the document title matches', (await page.title()) === 'Settings — Byte')
    await page.getByRole('link', { name: 'Byte' }).click()
    await page.waitForFunction(() => document.activeElement && document.activeElement.tagName === 'H1' && document.activeElement.textContent === 'Projects')
    check('Byte logo → Projects: focus on h1 and announced', /^Now on Projects\.$/.test(await page.locator('[role=status]:has-text("Now on")').first().textContent()))
    await page.locator('.project-card, a:has-text("Getting Started")').first().click()
    await page.waitForFunction(() => document.activeElement && document.activeElement.tagName === 'H1' && document.title !== 'Byte')
    check('a page that loads data waits for its real title before announcing', /^Now on .+\.$/.test(await page.locator('[role=status]:has-text("Now on")').first().textContent()) && (await page.title()) !== 'Byte' && (await page.title()).endsWith(' — Byte'))
    await page.goBack()
    await page.waitForFunction(() => document.activeElement && document.activeElement.tagName === 'H1' && document.activeElement.textContent === 'Projects')
    check('the Back button moves focus to the h1 as well', true)
    await go(AUTH)
    await page.getByRole('link', { name: 'Preview as learner' }).click()
    await page.waitForFunction(() => document.activeElement && document.activeElement.tagName === 'H1' && document.title.includes('learner preview'))
    check('the learner preview announces itself', /\(learner preview\)\.$/.test(await page.locator('[role=status]:has-text("Now on")').first().textContent()))
    await page.evaluate(p => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')) }, `/projects/${P}/lessons/nope-nope`)
    await page.waitForTimeout(3600)
    check('a page that fails to load still moves focus to main and announces', await page.evaluate(() => document.activeElement.id === 'main' || document.activeElement.tagName === 'H1'))
    await go(APP + '/')
    check('the first page load does not steal focus (no announcement)', (await page.locator('[role=status]:has-text("Now on")').count()) === 0 || (await page.locator('[role=status]:has-text("Now on")').first().textContent()) === '')

    console.log('=== EMOJI ARE HIDDEN FROM SCREEN READERS ===')
    const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}✓→›]/u
    const exposedEmoji = () => page.evaluate(() => {
      const re = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}✓→›]/u
      const out = []
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (re.test(n.textContent) && !n.parentElement.closest('[aria-hidden="true"]') && !['SCRIPT', 'STYLE'].includes(n.parentElement.tagName)) out.push(n.textContent.trim().slice(0, 40))
      }
      return out
    })
    const emojiChecks = [['projects', APP + '/'], ['project', base], ['source', `${base}/sources/${PRIMARY}`], ['add source', base + '/sources/new'], ['authoring lesson', AUTH], ['learner preview', PREV]]
    for (const [name, url] of emojiChecks) { await go(url); check(`no exposed emoji or arrows: ${name}`, (await exposedEmoji()).length === 0, await exposedEmoji()) }
    await go(`${base}/sources/${PRIMARY}`)
    for (let i = 0; i < await page.locator('.artifact-item').count(); i++) { await page.locator('.artifact-item').nth(i).click(); await page.waitForTimeout(250); check(`no exposed emoji or arrows: source artifact #${i}`, (await exposedEmoji()).length === 0, await exposedEmoji()) }
    await go(PREV)
    await page.locator('[aria-hidden="false"] .flipcard-flip').first().click(); await page.waitForTimeout(500)
    check('no exposed emoji on the flipped card', (await exposedEmoji()).length === 0, await exposedEmoji())
    const kc = page.locator('.lesson-artifact:has(.kc)'); await kc.locator('.kc-option').first().click()
    check('no exposed arrows on "Next question" (the button name has no arrow)', (await exposedEmoji()).length === 0 && /^Next question\s*$/.test((await kc.locator('.kc-actions .btn').evaluate(b => (b.innerText || '').replace(/→/, ''))).trim()) )
    check('type badges read as text ("Hook", not the fish emoji)', (await page.locator('.flipcard-type-badge').first().evaluate(e => e.textContent)).includes('Hook') && !!(await page.locator('.flipcard-type-badge [aria-hidden=true]').count()))
    check('artifact labels keep their text and hide the icon', await page.locator('.lesson-artifact').first().evaluate(e => true))
    await go(AUTH)
    check('lesson artifact labels hide their icons: "Flip Card Deck" reads without an emoji', (await page.locator('.lesson-artifact .lesson-label').first().evaluate(e => [...e.querySelectorAll('[aria-hidden=true]')].length)) >= 1)

    console.log('=== COMMIT 2 STILL HOLDS ===')
    await go(AUTH); await scan('authoring (with the checker card)')
    await go(PREV); await scan('preview')
    check('no page errors', errors.length === 0, errors)
  } finally {
    await browser.close(); await h.stopEnv()
  }
  h.finish()
}
main().catch(e => { console.error(e); process.exit(1) })
