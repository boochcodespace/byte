// Browser: the Settings page and provider presets
// Run by `npm run test:all`. Uses a mock AI model and a throwaway HOME.
const fs = require('fs')
const os = require('os')
const path = require('path')

const env = require('../support/env')
const HOME = env.HOME
const SHOT = env.SHOT

let pass = 0
let fail = 0
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS', name) }
  else { fail++; console.log('  FAIL', name, extra ?? '') }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(url) {
  for (let i = 0; i < 60; i++) {
    try { await fetch(url); return } catch { await sleep(250) }
  }
  throw new Error('timeout waiting for ' + url)
}

async function main() {
  await env.startEnv({ ui: true })

  const browser = await env.launchBrowser()
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  const consoleErrors = []
  page.on('response', r => { if (r.status() >= 400) console.log('   [http]', r.status(), r.url()) })
  page.on('pageerror', e => consoleErrors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) consoleErrors.push(m.text()) })  // browser logs for intentional HTTP errors are not app errors

  try {
    console.log('Settings page')
    await page.goto('http://localhost:5173/settings')
    await page.waitForSelector('#provider')
    const options = await page.$$eval('#provider option', os => os.map(o => o.textContent))
    check('6 providers in dropdown', options.length === 6, options)
    check('defaults to Anthropic', (await page.inputValue('#provider')) === 'anthropic')
    check('Save disabled with no key', await page.isDisabled('button[type=submit]'))
    check('model placeholder shows default', (await page.getAttribute('#model', 'placeholder')) === 'claude-sonnet-4-6')
    await page.screenshot({ path: path.join(SHOT, '1-anthropic.png') })

    console.log('Key-prefix hint')
    await page.fill('#apiKey', 'AIzaFakeKey123')
    check('hint suggests Gemini', await page.isVisible('text=looks like a Google (Gemini) key'))
    await page.click('text=Switch to Google (Gemini)')
    check('hint switches provider', (await page.inputValue('#provider')) === 'gemini')
    check('model placeholder updates', (await page.getAttribute('#model', 'placeholder')) === 'gemini-2.5-flash')

    console.log('Local model')
    await page.selectOption('#provider', 'local')
    check('API key field hidden', (await page.$('#apiKey')) === null)
    check('base URL shown with preset', (await page.inputValue('#baseUrl')) === 'http://localhost:11434/v1')
    check('Save disabled until model typed', await page.isDisabled('button[type=submit]'))
    await page.fill('#model', 'llama3.1')
    check('Save enabled with model', !(await page.isDisabled('button[type=submit]')))
    await page.screenshot({ path: path.join(SHOT, '2-local.png') })
    await page.click('button[type=submit]')
    await page.waitForSelector('text=Settings saved')
    check('save succeeds', true)

    await page.reload()
    await page.waitForSelector('#provider')
    check('provider persists after reload', (await page.inputValue('#provider')) === 'local')
    check('model persists', (await page.inputValue('#model')) === 'llama3.1')

    console.log('Saved key belongs to its provider')
    await page.selectOption('#provider', 'openai')
    await page.fill('#apiKey', 'sk-test-1111')
    await page.click('button[type=submit]')
    await page.waitForSelector('text=Settings saved')
    await page.selectOption('#provider', 'gemini')
    check('no "Key saved" badge for a different provider', (await page.$('.key-badge')) === null)
    check('Save disabled again (needs Gemini key)', await page.isDisabled('button[type=submit]'))
    await page.selectOption('#provider', 'openai')
    check('badge shows for the provider it was saved under', await page.isVisible('.key-badge'))

    console.log('Generate with an unreachable local server')
    await page.selectOption('#provider', 'local')
    await page.fill('#baseUrl', 'http://127.0.0.1:4999/v1')
    await page.fill('#model', 'llama3.1')
    await page.click('button[type=submit]')
    await page.waitForSelector('text=Settings saved')
    await fetch('http://localhost:5173/api/projects') // seeds the example project
    await page.goto('http://localhost:5173/projects/getting-started/sources/active-listening')
    await page.waitForSelector('text=Generate artifact')
    await page.click('button:has-text("Generate")')
    await page.waitForSelector('.error-state')
    const msg = await page.textContent('.error-state-message')
    check('network error shown', /Could not reach your AI provider/.test(msg), msg)
    check('message is provider-neutral', !/claude|anthropic/i.test(msg), msg)
    check('Retry button present', await page.isVisible('.error-state >> text=Retry'))
    await page.screenshot({ path: path.join(SHOT, '3-network-error.png') })

    console.log('Console')
    check('no page errors in console', consoleErrors.length === 0, consoleErrors)
  } finally {
    await browser.close()
    await env.stopEnv()
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
