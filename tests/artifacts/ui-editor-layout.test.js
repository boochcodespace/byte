// Browser: the shared editor layout (D2 commit 1b). Labels above fields in sentence
// case, fields that fill the width and grow with no clipping, option text and
// explanation side by side on a wide editor and stacked on a narrow one,
// collapsible question cards with a status, the key radio group, writing notes
// under their question, and a sticky Save bar that never covers a focused field.
// Run by `npm run test:all`. Uses a mock AI model and a throwaway HOME.
const h = require('../a11y/support/ui-harness')
const { APP, MOCK, P, PRIMARY, api, check, fs, path, HOME } = h
const { AxeBuilder } = require('@axe-core/playwright')
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function main() {
  await h.startEnv({ ui: true })
  await api('GET', '/projects')
  await api('POST', '/settings', { provider: 'local', model: 'm', baseUrl: `${MOCK}/v1` })
  await api('POST', `/projects/${P}/sources/${PRIMARY}/artifacts/generate`, { artifactType: 'knowledge-check' })
  const kc = (await api('GET', `/projects/${P}/artifacts?type=knowledge-check`)).data[0]
  // a long "apply today" line so wrapping is exercised
  const file = path.join(HOME, 'Byte', 'projects', P, 'sources', PRIMARY, 'artifacts', kc.folder, 'artifact.json')
  const art = JSON.parse(fs.readFileSync(file, 'utf-8'))
  art.apply_today = 'Next time a schedule comes across your desk, check the changeover time between every pair of products before you lock the order, and write down what you found so the next shift can see it. ' .repeat(3).trim()
  fs.writeFileSync(file, JSON.stringify(art))

  const browser = await h.launchBrowser()
  const errors = []
  const open = async width => {
    const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage()
    page.on('pageerror', e => errors.push(String(e)))
    await page.goto(`${APP}/projects/${P}/sources/${PRIMARY}`); await page.waitForTimeout(600)
    await page.locator('.artifact-item:has-text("Knowledge Check")').first().click()
    await page.getByRole('button', { name: 'Edit knowledge check' }).click()
    await page.locator('form[aria-label="Edit knowledge check"]').waitFor()
    return page
  }
  const scan = async (page, state) => {
    const r = await new AxeBuilder({ page }).withTags(WCAG).analyze()
    check(`axe 0 violations (WCAG 2.2 AA): ${state}`, r.violations.length === 0, r.violations.map(v => `${v.id} ${v.nodes[0].target.join(' ')}`))
  }

  try {
    console.log('=== WIDE (1200 px) ===')
    let page = await open(1200)
    const form = page.locator('form[aria-label="Edit knowledge check"]')
    const box = el => el.boundingBox()
    check('the editor gets the full width on the source page (the sidebar drops below)', (await box(form)).width > 900, (await box(form)).width)

    const labels = await form.locator('.ae-field > label').evaluateAll(ls => ls.map(l => {
      const f = l.parentElement.querySelector('textarea'); const a = l.getBoundingClientRect(); const b = f.getBoundingClientRect(); const cs = getComputedStyle(l)
      return { above: a.bottom <= b.top + 1, aligned: Math.abs(a.left - b.left) < 2, upper: cs.textTransform, spacing: cs.letterSpacing }
    }))
    check(`labels sit ABOVE their fields, left-aligned (${labels.length} fields)`, labels.length >= 20 && labels.every(l => l.above && l.aligned), labels.filter(l => !l.above || !l.aligned).length)
    check('labels are sentence case: no uppercase transform, no letter spacing', labels.every(l => l.upper === 'none' && l.spacing === 'normal'))

    const setup = form.getByLabel('Task setup')
    const wide = await box(setup)
    check('long text fields fill the width, up to about 900 px', wide.width >= 800 && wide.width <= 905, wide.width)
    const clipped = () => form.locator('textarea').evaluateAll(ts => ts.filter(t => t.scrollHeight > t.clientHeight + 1 || getComputedStyle(t).overflowY !== 'hidden').map(t => t.id))
    check('no field clips its text or shows an inner scrollbar (including the long "Apply today")', (await clipped()).length === 0, await clipped())
    const apply = form.getByLabel('Apply today')
    const h0 = (await box(apply)).height
    await apply.fill(Array.from({ length: 600 }, (_, i) => `word${i}`).join(' '))
    const hBig = (await box(apply)).height
    check('typing much more makes the field taller', hBig > h0 * 1.5, [h0, hBig])
    check('and the long text is not clipped, with no inner scrollbar', (await clipped()).length === 0, await clipped())
    await apply.fill('Short.')
    check('shorter text shrinks it back', (await box(apply)).height < hBig / 2)

    const opt = form.locator('section.ae-card').nth(0).locator('.ae-option').nth(0)
    const [t, e] = [await box(opt.getByLabel('Answer text')), await box(opt.getByLabel('Explanation'))]
    check('option text and explanation sit SIDE BY SIDE on a wide editor', Math.abs(t.y - e.y) < 3 && e.x > t.x + t.width - 2, { t, e })
    check('each option is one row, with its radio in the option header', await opt.locator('.ae-option-head input[type=radio]').count() === 1)

    const cards = form.locator('section.ae-card')
    check('every question is a card, all open by default', (await cards.count()) === 3 && (await form.locator('.ae-card-toggle[aria-expanded="true"]').count()) === 3)
    const head = n => cards.nth(n).locator('.ae-card-toggle')
    check('a card header shows the question and a status: "Key: A", and the notes count', /^Question 1: STEM-1/.test(await head(0).textContent()) && /Key: A/.test(await head(0).textContent()))
    check('the header is a button inside a real heading', await cards.nth(0).locator('h3 > button.ae-card-toggle').count() === 1)
    await head(1).click()
    check('collapsing hides the question\'s fields (not focusable) but keeps the stem and status visible', (await head(1).getAttribute('aria-expanded')) === 'false' && !(await cards.nth(1).getByLabel('Question text').isVisible()) && /STEM-2/.test(await head(1).textContent()) && /Key: A/.test(await head(1).textContent()))
    await scan(page, 'wide: a card collapsed')
    await head(1).focus(); await page.keyboard.press('Enter')
    check('Enter reopens it', (await head(1).getAttribute('aria-expanded')) === 'true' && await cards.nth(1).getByLabel('Question text').isVisible())
    await cards.nth(0).getByLabel('Question text').fill('STEM-1 what do you do first?')
    const firstNote = cards.nth(0).locator('.ae-notes')
    const [stemBox, notesBox, optsBox] = [await box(cards.nth(0).getByLabel('Question text')), await box(firstNote), await box(cards.nth(0).locator('fieldset.ae-options'))]
    check('writing notes sit directly under their question, above the options, labelled as advice', notesBox.y > stemBox.y + stemBox.height - 1 && notesBox.y + notesBox.height <= optsBox.y + 1 && /Writing advice for question 1/.test(await firstNote.locator('h4').textContent()))
    const legend = cards.nth(0).locator('fieldset.ae-options > legend')
    check('the key choice is a fieldset with the legend "Which option is the key?"', /^Which option is the key\?/.test(await legend.textContent()) && (await cards.nth(0).locator('fieldset.ae-options input[type=radio]').count()) === 3)
    await cards.nth(0).getByRole('radio', { name: 'Option A', exact: true }).focus()
    await page.keyboard.press('ArrowDown')
    check('arrow keys move the key within the group (native radios)', await cards.nth(0).getByRole('radio', { name: 'Option B', exact: true }).isChecked())
    check('the header status follows the key', /Key: B/.test(await head(0).textContent()))
    await cards.nth(0).getByLabel('Answer text', { exact: false }).nth(1).fill('Short')
    await scan(page, 'wide: editor, all cards open')

    console.log('=== THE STICKY SAVE BAR ===')
    const bar = form.locator('.ae-actions')
    await form.scrollIntoViewIfNeeded()
    await page.evaluate(() => window.scrollTo(0, window.scrollY - 200))
    await page.waitForTimeout(200)
    const vh = 900
    const bb = await box(bar)
    check('the bar stays at the bottom of the window while the editor is long', bb && bb.y + bb.height <= vh + 2 && bb.y + bb.height >= vh - 6, bb)
    check('Save changes and Cancel are in it', await bar.getByRole('button', { name: 'Save changes' }).isVisible() && await bar.getByRole('button', { name: 'Cancel' }).isVisible())
    // tab through every focusable field and check none sits under the bar
    await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement && document.activeElement.blur() })
    await form.getByLabel('Task setup').focus()
    let covered = [], stops = 0
    for (let i = 0; i < 70; i++) {
      await page.keyboard.press('Tab')
      const r = await page.evaluate(() => {
        const el = document.activeElement; const b = el.getBoundingClientRect(); const bar = document.querySelector('.ae-actions').getBoundingClientRect()
        return { inBar: !!el.closest('.ae-actions'), under: b.bottom > bar.top + 1 && b.top < bar.bottom && !el.closest('.ae-actions') && bar.top < window.innerHeight, label: (el.id || el.textContent || '').slice(0, 30) }
      })
      stops++
      if (r.under) covered.push(r.label)
      if (r.inBar && stops > 10) break
    }
    check(`tabbing forwards through the editor never leaves a focused field under the bar (${stops} stops)`, stops > 20 && covered.length === 0, covered)
    covered = []
    for (let i = 0; i < 70; i++) {
      await page.keyboard.press('Shift+Tab')
      const r = await page.evaluate(() => { const el = document.activeElement; const b = el.getBoundingClientRect(); const bar = document.querySelector('.ae-actions').getBoundingClientRect(); const head = document.querySelector('.app-header').getBoundingClientRect(); return { under: el !== document.body && !el.closest('.app-header, .skip-link') && ((b.bottom > bar.top + 1 && b.top < bar.bottom && !el.closest('.ae-actions')) || (b.top < head.bottom - 1 && b.bottom > head.top)), label: (el.id || el.textContent || '').slice(0, 30) } })
      if (r.under) covered.push(r.label)
    }
    check('and Shift+Tab backwards never leaves one under the bar or the header', covered.length === 0, covered)
    await page.close()

    console.log('=== NARROW (800 px) ===')
    page = await open(800)
    const form8 = page.locator('form[aria-label="Edit knowledge check"]')
    const opt8 = form8.locator('section.ae-card').nth(0).locator('.ae-option').nth(0)
    const [t8, e8] = [await opt8.getByLabel('Answer text').boundingBox(), await opt8.getByLabel('Explanation').boundingBox()]
    check('below about 900 px the option text and explanation STACK', e8.y > t8.y + t8.height - 1 && Math.abs(e8.x - t8.x) < 3, { t8, e8 })
    check('fields still fill the width (no narrow boxes)', (await form8.getByLabel('Task setup').boundingBox()).width > 600)
    check('no clipped text at 800 px', (await form8.locator('textarea').evaluateAll(ts => ts.filter(t => t.scrollHeight > t.clientHeight + 1).length)) === 0)
    await scan(page, 'narrow 800 px: editor')
    await page.close()

    console.log('=== PHONE (320 px) ===')
    page = await open(320)
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
    check('no horizontal scroll at 320 CSS px (400% zoom)', w.sw <= w.cw + 1, w)
    check('the Save bar still fits and stays reachable', await page.locator('.ae-actions').getByRole('button', { name: 'Save changes' }).isVisible())
    await scan(page, 'phone 320 px: editor')
    await page.close()

    check('no page errors', errors.length === 0, errors)
  } finally {
    await browser.close()
    await h.stopEnv()
  }
  h.finish()
}
main().catch(e => { console.error(e); process.exit(1) })
