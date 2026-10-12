// Runs the whole accessibility suite, one file at a time, and stops with a
// non-zero exit code if any check fails.
//
//   npm run test:a11y          everything (browser + API)
//   npm run test:a11y -- api   only the API files
//   npm run test:a11y -- ui    only the browser files
//
// Each file starts its own mock AI model, backend, and (for browser files)
// Vite dev server on a throwaway HOME. Your real ~/Byte folder is never
// touched. Stop `npm run dev` first: the suite needs ports 3001 and 5173.

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const dir = path.join(__dirname, 'a11y')
const filter = process.argv[2]
const files = fs.readdirSync(dir)
  .filter(f => f.endsWith('.test.js'))
  .filter(f => !filter || f.startsWith(filter + '-'))
  .sort((a, b) => (a.startsWith('api') === b.startsWith('api') ? a.localeCompare(b) : a.startsWith('api') ? -1 : 1))

const results = []
for (const f of files) {
  console.log(`\n━━━ ${f} ━━━`)
  const r = spawnSync('node', [path.join(dir, f)], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
  const out = r.stdout || ''
  const failures = out.split('\n').filter(l => /^\s*FAIL /.test(l))
  const summary = out.split('\n').reverse().find(l => /passed, \d+ failed/.test(l)) || '(no summary: the file crashed)'
  failures.forEach(l => console.log(l))
  if (r.status !== 0 && failures.length === 0) console.log(out.split('\n').slice(-15).join('\n'))
  console.log(summary)
  results.push({ file: f, summary: summary.trim(), ok: r.status === 0 })
}

console.log('\n━━━ Accessibility suite ━━━')
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.file}  ${r.summary}`)
const bad = results.filter(r => !r.ok)
console.log(bad.length ? `\n${bad.length} of ${results.length} files failed.` : `\nAll ${results.length} files passed.`)
process.exit(bad.length ? 1 : 0)
