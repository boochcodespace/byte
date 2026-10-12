// API: editing a saved knowledge check's words in place (D2 commit 1): the
// exactly-one-key schema, needs-a-key for older files, edited flag, shared
// artifacts and copies, and the item-writing notes.
// Run by `npm run test:all`. Uses a mock AI model and a throwaway HOME.
const h = require('../a11y/support/api-harness')
const { HOME, L, MOCK, P, PRIMARY, REPO, api, check, fs, newApprovedLesson, path, setMode, sleep } = h

async function main() {
  await h.startEnv({ ui: false })
  try {
    await api('GET', '/projects')
    await api('POST', '/settings', { provider: 'local', model: 'm', baseUrl: `${MOCK}/v1` })
    const GEN = `/projects/${P}/sources/${PRIMARY}/artifacts/generate`
    const A = `/projects/${P}/artifacts`
    const artDir = f => path.join(HOME, 'Byte', 'projects', P, 'sources', PRIMARY, 'artifacts', f)
    const readArt = f => JSON.parse(fs.readFileSync(path.join(artDir(f), 'artifact.json'), 'utf-8'))
    const writeArt = (f, a) => fs.writeFileSync(path.join(artDir(f), 'artifact.json'), JSON.stringify(a))
    const lessonOf = async id => (await api('GET', `${L}/${id}`)).data
    const newKC = async () => { await sleep(5); const r = await api('POST', GEN, { artifactType: 'knowledge-check' }); return r }
    const kcList = async () => (await api('GET', `${A}?type=knowledge-check`)).data
    const get = f => api('GET', `${A}/${PRIMARY}/${f}`)
    const put = (f, body) => api('PUT', `${A}/${PRIMARY}/${f}`, body)
    // the editor's payload for the current text of an artifact
    const payloadOf = art => ({ setup: art.setup, apply_today: art.apply_today, items: art.items.map(it => ({ stem: it.stem, ...(it.scenario !== undefined ? { scenario: it.scenario } : {}), options: it.options.map(o => ({ text: o.text, rationale: o.rationale, correct: o.correct })) })) })

    console.log('The schema: exactly one key')
    const Ajv = require(path.join(REPO, 'backend', 'node_modules', 'ajv'))
    const schema = require(path.join(REPO, 'backend', 'artifact-types', 'knowledge-check', 'schema.json'))
    const validate = new Ajv({ allErrors: true, strict: false }).compile(schema)
    const mk = flags => ({ learning_objective: 'o', setup: 's', apply_today: 'a', items: [{ id: 'q1', stem: 'stem', options: flags.map((c, i) => ({ text: `t${i}`, correct: c, rationale: `r${i}` })) }] })
    for (const flags of [[true, false, false], [false, true, false], [false, false, true], [true, false, false, false], [false, false, false, true]]) {
      check(`one key passes: ${flags.map(f => (f ? 'K' : '-')).join('')}`, validate(mk(flags)) === true, validate.errors)
    }
    for (const flags of [[false, false, false], [true, true, false], [true, true, true], [false, false, false, false], [true, false, true, false], [true, true, true, true]]) {
      check(`zero or several keys fails: ${flags.map(f => (f ? 'K' : '-')).join('')}`, validate(mk(flags)) === false)
    }
    check('two options is still too few', validate(mk([true, false])) === false)

    console.log('Generation uses the stricter schema')
    setMode('kc_two_keys'); let r = await api('POST', GEN, { artifactType: 'knowledge-check' }); setMode('ok')
    check('a model that marks two options as the key is rejected (schema_validation)', r.errorType === 'schema_validation', r.errorType)
    setMode('kc_no_key'); r = await api('POST', GEN, { artifactType: 'knowledge-check' }); setMode('ok')
    check('a model that marks none is rejected', r.errorType === 'schema_validation', r.errorType)
    r = await newKC()
    check('a normal knowledge check still generates', r.ok === true, r)

    console.log('Reading an artifact for editing')
    const kcs = await kcList()
    const f1 = kcs[0].folder
    r = await get(f1)
    check('GET returns the artifact, its type, usage, and that it is editable', r.ok && r.data.type === 'knowledge-check' && r.data.editable === true && Array.isArray(r.data.usage) && r.data.artifact.folder === f1 && r.data.artifact.items.length === 3, r)
    check('a good file has nothing flagged as needing a key', r.data.needs_key.length === 0)
    check('unsafe ids → not_found', (await api('GET', `${A}/a..b/x`)).errorType === 'not_found' && (await api('GET', `${A}/${PRIMARY}/..%2f..`)).errorType === 'not_found')
    check('unknown artifact → not_found', (await get('knowledge-check-1')).errorType === 'not_found')
    check('unknown project → not_found', (await api('GET', `/projects/nope/artifacts/${PRIMARY}/${f1}`)).errorType === 'not_found')

    console.log('Saving edits')
    const before = readArt(f1)
    check('a saved check has no edited flag yet', before.edited === undefined)
    const p1 = payloadOf(before)
    r = await put(f1, p1)
    check('saving the same words changes nothing and sets no edited flag', r.ok && r.data.changed === false && readArt(f1).edited === undefined && readArt(f1).edited_at === undefined, r)
    const p2 = payloadOf(before)
    p2.setup = 'NEW SETUP words.'
    p2.apply_today = 'NEW APPLY line.'
    p2.items[0].stem = 'NEW STEM 1 what do you do first?'
    p2.items[0].options[1].text = 'NEW OPTION text'
    p2.items[0].options[1].rationale = 'NEW RATIONALE'
    r = await put(f1, p2)
    const after = readArt(f1)
    check('a real change saves, returns changed:true, and sets edited and edited_at', r.ok && r.data.changed === true && after.edited === true && /^\d{4}-/.test(after.edited_at), r)
    check('the new words are on disk', after.setup === 'NEW SETUP words.' && after.apply_today === 'NEW APPLY line.' && after.items[0].stem.startsWith('NEW STEM 1') && after.items[0].options[1].text === 'NEW OPTION text' && after.items[0].options[1].rationale === 'NEW RATIONALE')
    check('everything else is untouched (ids, labels, notes, other items)', after.items[0].id === before.items[0].id && after.items[0].bloom_level === before.items[0].bloom_level && after.learning_objective === before.learning_objective && JSON.stringify(after.items[1]) === JSON.stringify(before.items[1]) && after.type === before.type)
    check('saving the identical edit again is not a change', (await put(f1, p2)).data.changed === false)
    check('the response lists the lessons that use it', Array.isArray(r.data.usage))

    console.log('Which option is the key')
    const p3 = payloadOf(readArt(f1))
    p3.items[2].options.forEach((o, i) => { o.correct = i === 1 })
    r = await put(f1, p3)
    const keysNow = readArt(f1).items[2].options.map(o => o.correct)
    check('moving the key to another option saves', r.ok && r.data.changed && JSON.stringify(keysNow) === '[false,true,false]', keysNow)
    const p4 = payloadOf(readArt(f1)); p4.items[1].options.forEach(o => { o.correct = false })
    r = await put(f1, p4)
    check('zero keys is refused with a plain message naming the question', r.errorType === 'validation' && /^Question 2 has no option marked as the key\. Mark exactly one option as the key\.$/.test(r.userMessage), r.userMessage)
    const p5 = payloadOf(readArt(f1)); p5.items[0].options.forEach(o => { o.correct = true })
    r = await put(f1, p5)
    check('three keys is refused with a plain message', r.errorType === 'validation' && /^Question 1 has 3 options marked as the key/.test(r.userMessage), r.userMessage)
    const p6 = payloadOf(readArt(f1)); p6.items[0].options.forEach(o => { o.correct = false }); p6.items[2].options.forEach(o => { o.correct = true })
    r = await put(f1, p6)
    check('several questions with a key problem: the message says how many', /\(2 questions need a key\)/.test(r.userMessage), r.userMessage)
    check('a refused save changes nothing: every question still has exactly one key', readArt(f1).items.every(it => it.options.filter(o => o.correct).length === 1))

    console.log('Shape and text rules')
    const bad = fn => { const p = payloadOf(readArt(f1)); fn(p); return put(f1, p) }
    r = await bad(p => p.items.pop())
    check('removing a question is refused', r.errorType === 'validation' && /not add or remove questions/.test(r.userMessage), r.userMessage)
    r = await bad(p => p.items[0].options.pop())
    check('removing an option is refused', r.errorType === 'validation' && /not add or remove options/.test(r.userMessage), r.userMessage)
    r = await bad(p => p.items[0].options.push({ text: 'x', rationale: 'y', correct: false }))
    check('adding an option is refused', r.errorType === 'validation')
    r = await bad(p => { p.items[0].options[2].text = '   ' })
    check('an empty option names where: "Question 1, option C: the answer text cannot be empty."', r.errorType === 'validation' && r.userMessage === 'Question 1, option C: the answer text cannot be empty.', r.userMessage)
    r = await bad(p => { p.items[1].stem = '' })
    check('an empty question is refused with its number', r.errorType === 'validation' && /^Question 2: the question cannot be empty\./.test(r.userMessage), r.userMessage)
    r = await bad(p => { p.items[0].options[0].rationale = '' })
    check('an empty explanation is refused', /option A: the explanation cannot be empty/.test(r.userMessage), r.userMessage)
    r = await bad(p => { p.setup = '' })
    check('an empty setup is refused', /task setup cannot be empty/i.test(r.userMessage), r.userMessage)
    r = await bad(p => { p.items[0].options[0].text = 'x'.repeat(1001) })
    check('only an absurdly long option (over 1,000) is refused', r.errorType === 'validation' && /up to 1,000 characters/.test(r.userMessage), r.userMessage)
    r = await bad(p => { p.items[0].options[0].correct = 'yes' })
    check('a non-boolean key is refused', r.errorType === 'validation')
    r = await put(f1, { items: 'nope' })
    check('a malformed items value is refused', r.errorType === 'validation')
    r = await api('PUT', `${A}/${PRIMARY}/${f1}`, { id: 'hack', type: 'flip-card-deck', learning_objective: 'HACKED', items: payloadOf(readArt(f1)).items.map(it => ({ ...it, id: 'hack', bloom_level: 'x' })) })
    check('fields that are not editable (type, objective, ids, labels) are ignored', readArt(f1).type === 'knowledge-check' && readArt(f1).learning_objective !== 'HACKED' && readArt(f1).items[0].id !== 'hack' && readArt(f1).items[0].bloom_level !== 'x')

    console.log('Older files with no key or several keys')
    r = await newKC(); await sleep(5)
    const f2 = (await kcList())[0].folder
    const legacy = readArt(f2)
    legacy.items[1].options.forEach(o => { o.correct = false })
    legacy.items[2].options.forEach(o => { o.correct = true })
    writeArt(f2, legacy)
    r = await get(f2)
    check('they open flagged: item 2 has 0 keys, item 3 has 3 keys', JSON.stringify(r.data.needs_key) === '[{"item":1,"keys":0},{"item":2,"keys":3}]', r.data.needs_key)
    check('they still read fine (renderers keep working on old files)', r.ok && r.data.artifact.items.length === 3)
    r = await put(f2, payloadOf(readArt(f2)))
    check('saving without fixing them is blocked, even with no other change', r.errorType === 'validation' && /^Question 2 has no option marked as the key/.test(r.userMessage), r.userMessage)
    const fixed = payloadOf(readArt(f2)); fixed.items[1].options[0].correct = true; fixed.items[2].options.forEach((o, i) => { o.correct = i === 2 })
    r = await put(f2, fixed)
    check('marking exactly one in each question lets it save', r.ok && r.data.changed === true && readArt(f2).edited === true && (await get(f2)).data.needs_key.length === 0, r.userMessage)

    console.log('Lessons that use an artifact')
    const idA = await newApprovedLesson(), idB = await newApprovedLesson()
    for (const id of [idA, idB]) { setMode('ok'); await api('POST', `${L}/${id}/text/generate`) }
    const accept = async (lid, ref) => { const b = (await lessonOf(lid)).lesson.blocks.find(x => x.artifact_type === 'knowledge-check' && x.state === 'proposed'); return api('POST', `${L}/${lid}/blocks/${b.id}/artifact`, { mode: 'existing', source: PRIMARY, artifact: ref }) }
    await accept(idA, f1); await accept(idB, f1)
    r = await get(f1)
    check('usage names every lesson that uses it', r.data.usage.length === 2 && r.data.usage.every(u => u.title && u.lesson_id && u.block_id) && new Set(r.data.usage.map(u => u.lesson_id)).size === 2, r.data.usage)
    check('an unused artifact has no usage', (await get(f2)).data.usage.length === 0)
    const pe = payloadOf(readArt(f1)); pe.items[0].stem = 'SHARED EDIT stem'
    await put(f1, pe)
    const la = await lessonOf(idA), lb = await lessonOf(idB)
    const key = `${PRIMARY}/${f1}`
    check('an edit shows in EVERY lesson that references the artifact', la.artifacts[key].items[0].stem === 'SHARED EDIT stem' && lb.artifacts[key].items[0].stem === 'SHARED EDIT stem' && la.artifacts[key].edited === true)
    const long = payloadOf(readArt(f1)); long.items[0].stem = Array.from({ length: 400 }, (_, i) => `w${i}`).join(' ')
    const minBefore = lb.lesson.total_minutes
    await put(f1, long)
    check('the time meter follows the new words (a much longer question adds minutes)', (await lessonOf(idB)).lesson.total_minutes > minBefore, [minBefore, (await lessonOf(idB)).lesson.total_minutes])

    console.log('Make a copy for this lesson')
    const blockA = (await lessonOf(idA)).lesson.blocks.find(b => b.artifact_type === 'knowledge-check' && b.state === 'ready')
    r = await api('POST', `${L}/${idA}/blocks/${blockA.id}/artifact/copy`, {})
    const nb = r.data.lesson.blocks.find(b => b.id === blockA.id)
    check('the copy is in the SAME source folder with a new folder name', r.ok && nb.ref.source === PRIMARY && nb.ref.artifact !== f1 && /^knowledge-check-\d+$/.test(nb.ref.artifact) && fs.existsSync(artDir(nb.ref.artifact)), nb.ref)
    const copy = readArt(nb.ref.artifact)
    check('the copy keeps edited and the words, and records where it came from', copy.edited === true && copy.items[0].stem === long.items[0].stem && copy.copied_from.artifact === f1 && copy.copied_from.source === PRIMARY, copy.copied_from)
    check('this lesson now uses the copy; the other lesson still uses the original', nb.ref.artifact !== f1 && (await lessonOf(idB)).lesson.blocks.find(b => b.artifact_type === 'knowledge-check' && b.state === 'ready').ref.artifact === f1)
    check('the block keeps its generation_context (the same block, a new reference)', JSON.stringify(nb.generation_context) === JSON.stringify(blockA.generation_context))
    const pc = payloadOf(copy); pc.items[0].stem = 'ONLY IN THIS LESSON'
    await put(nb.ref.artifact, pc)
    check('editing the copy leaves the original, and the other lesson, alone', readArt(f1).items[0].stem === long.items[0].stem && (await lessonOf(idB)).artifacts[key].items[0].stem === long.items[0].stem && (await lessonOf(idA)).artifacts[`${PRIMARY}/${nb.ref.artifact}`].items[0].stem === 'ONLY IN THIS LESSON')
    check('the original now lists one lesson; the copy lists one', (await get(f1)).data.usage.length === 1 && (await get(nb.ref.artifact)).data.usage.length === 1)
    check('copying a block that is not an artifact → not_found', (await api('POST', `${L}/${idA}/blocks/${(await lessonOf(idA)).lesson.blocks[0].id}/artifact/copy`, {})).errorType === 'not_found')
    r = await api('POST', `${A}/${PRIMARY}/${f1}/copy`, {})
    check('a standalone copy works too: a new folder, edited kept', r.ok && r.data.artifact !== f1 && readArt(r.data.artifact).edited === true)
    check('copying a missing artifact → not_found', (await api('POST', `${A}/${PRIMARY}/nope-1/copy`, {})).errorType === 'not_found')

    console.log('Regenerate leaves the edited version alone')
    const blockB = (await lessonOf(idB)).lesson.blocks.find(b => b.artifact_type === 'knowledge-check' && b.state === 'ready')
    setMode('ok')
    r = await api('POST', `${L}/${idB}/blocks/${blockB.id}/artifact`, { mode: 'new' })
    const rb = r.data.lesson.blocks.find(b => b.id === blockB.id)
    check('regenerating makes a NEW artifact for this lesson', r.ok && rb.ref.artifact !== f1)
    check('the edited version stays in the project, intact', fs.existsSync(artDir(f1)) && readArt(f1).edited === true && readArt(f1).items[0].stem === long.items[0].stem)
    check('another lesson that used the edited artifact is not affected', (await lessonOf(idA)).lesson.blocks.some(b => b.ref && b.ref.artifact !== f1) && (await get(f1)).data.usage.length === 0)

    console.log('The accessibility checker flags a knowledge check with no key')
    await newKC(); await sleep(5)
    const f3 = (await kcList())[0].folder
    const leg = readArt(f3); leg.items[0].options.forEach(o => { o.correct = false }); leg.items[2].options.forEach(o => { o.correct = true }); writeArt(f3, leg)
    const idK = await newApprovedLesson(); setMode('ok'); await api('POST', `${L}/${idK}/text/generate`)
    await accept(idK, f3)
    r = await api('GET', `${L}/${idK}/a11y`)
    const nk = r.data.issues.filter(i => i.rule === 'knowledge-check-no-key')
    check('one warning per flagged question, each with its question number and a Fix to the editor', nk.length === 2 && nk.every(i => i.severity === 'warning' && i.fix === 'edit' && i.blockId) && JSON.stringify(nk.map(i => i.question)) === '[0,2]', nk)
    check('the messages say what is wrong in plain words', /Question 1 has no option marked as the key/.test(nk[0].message) && /Question 3 has 3 options marked as the key/.test(nk[1].message), nk.map(i => i.message))
    check('they are warnings, so they do not block an export', !r.data.issues.some(i => i.rule === 'knowledge-check-no-key' && i.severity === 'error'))
    const fixed3 = payloadOf(readArt(f3)); fixed3.items[0].options[0].correct = true; fixed3.items[2].options.forEach((o, i) => { o.correct = i === 0 })
    await put(f3, fixed3)
    check('once each question has a key the warnings are gone', (await api('GET', `${L}/${idK}/a11y`)).data.issues.filter(i => i.rule === 'knowledge-check-no-key').length === 0)

    console.log('Other artifact types are not editable yet')
    await api('POST', GEN, { artifactType: 'flip-card-deck' })
    const deck = (await api('GET', `${A}?type=flip-card-deck`)).data[0]
    check('a flip deck reports editable:false', (await get(deck.folder)).data.editable === false)
    check('saving a flip deck → a plain "not available yet" message', (await put(deck.folder, { items: [] })).userMessage === 'Editing this kind of artifact is not available yet.')

    console.log('Item-writing notes (advisory)')
    const { checkItem, keyCount } = await import(path.join(REPO, 'frontend', 'src', 'lib', 'itemChecks.mjs'))
    const item = (opts, extra = {}) => ({ stem: 'What do you do first?', options: opts.map(([text, correct, rationale]) => ({ text, correct, rationale: rationale || 'r' })), ...extra })
    const ids = notes => notes.map(n => n.id)
    check('a clean item has no notes', checkItem(item([['Ask a question', true], ['Wait', false], ['Leave the room', false]])).length === 0)
    check('the key as the longest option is noted, and names its letter', (() => { const n = checkItem(item([['Short', false], ['The longest answer by far here', true], ['Medium text', false]])); return ids(n).includes('key-longest') && /option B/.test(n.find(x => x.id === 'key-longest').message) })())
    check('a key that ties for longest is not noted', !ids(checkItem(item([['abcd', true], ['abcd', false], ['abc', false]]))).includes('key-longest'))
    check('"option B" in a rationale is a position reference', ids(checkItem(item([['One', true, 'This is better than option B because it is.'], ['Two', false], ['Three', false]]))).includes('position-reference'))
    check('"the first answer" in the question is a position reference', ids(checkItem(item([['One', true], ['Two', false], ['Three', false]], { stem: 'Why is the first answer wrong?' }))).includes('position-reference'))
    check('"all of the above" is noted', ids(checkItem(item([['All of the above', false], ['Two', true], ['Three', false]]))).includes('all-none-combo'))
    check('"A and B" is noted', ids(checkItem(item([['A and B', false], ['Two', true], ['Three', false]]))).includes('all-none-combo'))
    check('absolute words are noted ("never")', ids(checkItem(item([['Never ask', false], ['Two', true], ['Three', false]]))).includes('absolute-word'))
    check('a negative stem is noted (NOT, EXCEPT, LEAST)', ids(checkItem(item([['One', true], ['Two', false], ['Three', false]], { stem: 'Which is NOT a good first step?' }))).includes('negative-stem'))
    check('duplicate options are noted', ids(checkItem(item([['Same text', true], ['same  text.', false], ['Three', false]]))).includes('duplicate-options'))
    check('keyCount counts the options marked as the key', keyCount(item([['a', true], ['b', true], ['c', false]])) === 2 && keyCount(item([['a', false], ['b', false], ['c', false]])) === 0)
  } finally {
    await h.stopEnv()
  }
  h.finish()
}
main().catch(e => { console.error(e); process.exit(1) })
