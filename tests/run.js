// Runs Byte's test suites, one file at a time, and stops with a non-zero exit
// code if any check fails.
//
//   npm run test:all                      every suite, accessibility included
//   npm run test:all -- lessons           one area
//   npm run test:all -- api               only API files (no browser)
//   npm run test:all -- ui                only browser files
//   npm run test:all -- a11y ui           an area and a kind together
//   npm run test:all -- --list            show what would run
//   npm run test:a11y                     shortcut for: a11y
//
// Areas are the folders under tests/: a11y, lessons, artifacts, settings,
// providers. Kinds come from the file name: api-*.test.js needs no browser,
// ui-*.test.js does. Filters narrow the run: areas are alternatives, kinds are
// alternatives, and an area and a kind together must both match.
//
// Every file starts its own mock AI model, backend, and (for browser files)
// Vite dev server on a throwaway HOME. Your real ~/Byte is never touched. Stop
// `npm run dev` first: the suite needs ports 3001 and 5173.

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const KINDS = new Set(['api', 'ui'])
const args = process.argv.slice(2)
const listOnly = args.includes('--list')
const filters = args.filter(a => !a.startsWith('--'))
const kinds = filters.filter(f => KINDS.has(f))
const areas = filters.filter(f => !KINDS.has(f))

const root = __dirname
const allAreas = fs.readdirSync(root, { withFileTypes: true })
  .filter(d => d.isDirectory() && d.name !== 'node_modules' && d.name !== 'support')
  .map(d => d.name)
  .sort()

const unknown = areas.filter(a => !allAreas.includes(a))
if (unknown.length) {
  console.error(`Unknown area: ${unknown.join(', ')}. Areas: ${allAreas.join(', ')}. Kinds: api, ui.`)
  process.exit(2)
}

const files = []
for (const area of allAreas) {
  for (const f of fs.readdirSync(path.join(root, area)).filter(f => f.endsWith('.test.js')).sort()) {
    const kind = f.split('-')[0]
    if (areas.length && !areas.includes(area)) continue
    if (kinds.length && !kinds.includes(kind)) continue
    files.push({ area, file: f, kind, full: path.join(root, area, f) })
  }
}
// API files first: they are fast and catch most breakage before a browser starts.
files.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'api' ? -1 : 1))

if (!files.length) { console.error('No test files match those filters.'); process.exit(2) }
if (listOnly) {
  for (const f of files) console.log(`${f.area.padEnd(10)} ${f.kind.padEnd(4)} ${f.file}`)
  process.exit(0)
}

const results = []
for (const f of files) {
  console.log(`\n━━━ ${f.area}/${f.file} ━━━`)
  const r = spawnSync('node', [f.full], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf-8', maxBuffer: 128 * 1024 * 1024 })
  const out = r.stdout || ''
  const failures = out.split('\n').filter(l => /^\s*FAIL /.test(l))
  const summary = out.split('\n').reverse().find(l => /\d+ passed, \d+ failed/.test(l)) || '(no summary: the file crashed)'
  failures.forEach(l => console.log(l.slice(0, 600)))
  if (r.status !== 0 && failures.length === 0) console.log(out.split('\n').slice(-15).join('\n'))
  console.log(summary)
  const m = /(\d+) passed, (\d+) failed/.exec(summary)
  results.push({ ...f, summary: summary.trim(), ok: r.status === 0, passed: m ? Number(m[1]) : 0, failed: m ? Number(m[2]) : 0 })
}

console.log('\n━━━ Summary ━━━')
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.area}/${r.file}  ${r.summary}`)
const bad = results.filter(r => !r.ok)
const total = results.reduce((n, r) => n + r.passed + r.failed, 0)
const passed = results.reduce((n, r) => n + r.passed, 0)
console.log(bad.length
  ? `\n${bad.length} of ${results.length} files failed (${passed} of ${total} checks passed).`
  : `\nAll ${results.length} files passed (${total} checks).`)
process.exit(bad.length ? 1 : 0)
