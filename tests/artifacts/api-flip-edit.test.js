// API: editing a saved flip card deck's words in place (D2 commit 2): card
// fronts and backs, the deck's visual alt text fields, the edited flag, shape
// rules, the alt text rule, the standalone alt text draft, and the card notes.
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
    const newDeck = async () => { await sleep(5); await api('POST', GEN, { artifactType: 'flip-card-deck' }); return (await api('GET', `${A}?type=flip-card-deck`)).data[0].folder }
    const get = f => api('GET', `${A}/${PRIMARY}/${f}`)
    const put = (f, body) => api('PUT', `${A}/${PRIMARY}/${f}`, body)
    const payloadOf = art => ({
      visual_anchor_description: art.visual_anchor_description || '', alt_text: art.alt_text || '', long_description: art.long_description || '',
      decorative: art.decorative === true, decorative_reason: art.decorative_reason || '',
      cards: art.cards.map(c => ({ front: c.front, back: c.back })),
    })

    console.log('Reading a deck for editing')
    const f1 = await newDeck()
    let r = await get(f1)
    check('GET: editable, four cards, no alt problem, no key problem', r.ok && r.data.type === 'flip-card-deck' && r.data.editable === true && r.data.artifact.cards.length === 4 && r.data.needs_alt === false && r.data.needs_key.length === 0, r)
    const before = readArt(f1)
    check('a generated deck has an alt text and no edited flag yet', before.alt_text === 'DECK-ALT' && before.edited === undefined)

    console.log('Saving edits')
    r = await put(f1, payloadOf(before))
    check('the same words change nothing', r.ok && r.data.changed === false && readArt(f1).edited === undefined)
    const p2 = payloadOf(before)
    p2.cards[0].front = 'NEW FRONT 1 what is it?'
    p2.cards[2].back = 'NEW BACK 3 an answer'
    r = await put(f1, p2)
    const after = readArt(f1)
    check('a real change saves: edited, edited_at, and the new words', r.ok && r.data.changed && after.edited === true && /^\d{4}-/.test(after.edited_at) && after.cards[0].front === 'NEW FRONT 1 what is it?' && after.cards[2].back === 'NEW BACK 3 an answer', r)
    check('card types, other cards, and the objective are untouched', after.cards.every((c, i) => c.type === before.cards[i].type) && after.cards[1].front === before.cards[1].front && after.learning_objective === before.learning_objective && after.estimated_minutes === before.estimated_minutes)
    check('the identical edit again is not a change', (await put(f1, p2)).data.changed === false)

    console.log('Shape and text rules')
    const bad = fn => { const p = payloadOf(readArt(f1)); fn(p); return put(f1, p) }
    r = await bad(p => p.cards.pop())
    check('removing a card is refused', r.errorType === 'validation' && /not add or remove cards/.test(r.userMessage), r.userMessage)
    r = await bad(p => p.cards.push({ front: 'x', back: 'y' }))
    check('adding a card is refused', r.errorType === 'validation')
    r = await bad(p => { p.cards[1].front = '  ' })
    check('an empty front names the card: "Card 2: the front cannot be empty."', r.userMessage === 'Card 2: the front cannot be empty.', r.userMessage)
    r = await bad(p => { p.cards[3].back = '' })
    check('an empty back names the card', r.userMessage === 'Card 4: the back cannot be empty.', r.userMessage)
    r = await bad(p => { p.cards[0].front = 'x'.repeat(1001) })
    check('only an absurd front (over 1,000) is refused', /up to 1,000 characters/.test(r.userMessage), r.userMessage)
    r = await put(f1, { cards: 'nope' })
    check('a malformed cards value is refused', r.errorType === 'validation')
    await api('PUT', `${A}/${PRIMARY}/${f1}`, { type: 'knowledge-check', learning_objective: 'HACKED', cards: readArt(f1).cards.map(c => ({ type: 'apply', front: c.front, back: c.back })) })
    check('fields that are not editable (type, objective, card type) are ignored', readArt(f1).type === 'flip-card-deck' && readArt(f1).learning_objective !== 'HACKED' && readArt(f1).cards[0].type === before.cards[0].type)

    console.log("The deck's visual: alt text, long description, decorative")
    const vis = fn => { const p = payloadOf(readArt(f1)); fn(p); return put(f1, p) }
    r = await vis(p => { p.alt_text = 'A new alt text.'; p.long_description = 'Part one. Part two.' })
    check('alt text and a long description save', r.ok && readArt(f1).alt_text === 'A new alt text.' && readArt(f1).long_description === 'Part one. Part two.', r.userMessage)
    r = await vis(p => { p.alt_text = 'x'.repeat(300) })
    check('a 300-character alt text saves (125 is a soft guide)', r.ok === true)
    r = await vis(p => { p.alt_text = 'x'.repeat(2001) })
    check('only an absurd one (over 2,000) is refused', r.errorType === 'validation')
    r = await vis(p => { p.alt_text = ''; p.long_description = '' })
    check('a deck that describes a visual cannot be saved with no alt text', r.errorType === 'validation' && /needs alt text/.test(r.userMessage) && /decorative with a reason/.test(r.userMessage), r.userMessage)
    check('...and nothing was written', readArt(f1).alt_text.length === 300)
    r = await vis(p => { p.alt_text = ''; p.decorative = true; p.decorative_reason = '' })
    check('decorative with no reason is refused', r.errorType === 'validation' && /Say why the visual is decorative/.test(r.userMessage), r.userMessage)
    r = await vis(p => { p.alt_text = 'ignored'; p.long_description = 'ignored too'; p.decorative = true; p.decorative_reason = 'A border only.' })
    const dec = readArt(f1)
    check('decorative with a reason saves and drops the alt text', r.ok && dec.decorative === true && dec.decorative_reason === 'A border only.' && dec.alt_text === undefined && dec.long_description === undefined, dec)
    r = await vis(p => { p.decorative = false; p.alt_text = 'Back to described.' })
    const back = readArt(f1)
    check('switching back to described clears the decorative flag', r.ok && back.decorative === undefined && back.decorative_reason === undefined && back.alt_text === 'Back to described.')
    r = await vis(p => { p.visual_anchor_description = ''; p.alt_text = 'left behind' })
    const none = readArt(f1)
    check('clearing the visual removes every alternative (no visual, no alt text)', r.ok && none.visual_anchor_description === undefined && none.alt_text === undefined && none.decorative === undefined, none)
    r = await vis(p => { p.visual_anchor_description = 'A new diagram of the idea.'; p.alt_text = '' })
    check('describing a visual again needs alt text again', r.errorType === 'validation')
    r = await vis(p => { p.visual_anchor_description = 'A new diagram of the idea.'; p.alt_text = 'Shows the idea.' })
    check('with alt text it saves', r.ok && readArt(f1).visual_anchor_description === 'A new diagram of the idea.' && readArt(f1).alt_text === 'Shows the idea.')

    console.log('Older decks with a visual and no alt text')
    const f2 = await newDeck()
    const old = readArt(f2); delete old.alt_text; writeArt(f2, old)
    r = await get(f2)
    check('they open flagged needs_alt', r.data.needs_alt === true && r.data.artifact.cards.length === 4)
    r = await put(f2, { cards: payloadOf(old).cards.map((c, i) => ({ ...c, front: i === 0 ? 'Fixed a typo in card one' : c.front })) })
    check('a card edit alone is blocked until the visual has alt text', r.errorType === 'validation' && /needs alt text/.test(r.userMessage), r.userMessage)
    r = await put(f2, { cards: payloadOf(old).cards.map((c, i) => ({ ...c, front: i === 0 ? 'Fixed a typo in card one' : c.front })), alt_text: 'The diagram shows the changeover matrix.' })
    check('with alt text added in the same save it passes', r.ok && readArt(f2).cards[0].front === 'Fixed a typo in card one' && readArt(f2).alt_text === 'The diagram shows the changeover matrix.' && readArt(f2).edited === true, r.userMessage)
    check('and it is no longer flagged', (await get(f2)).data.needs_alt === false)
    const f3 = await newDeck()
    const noVisual = readArt(f3); delete noVisual.visual_anchor_description; delete noVisual.alt_text; writeArt(f3, noVisual)
    r = await put(f3, { cards: payloadOf(noVisual).cards.map((c, i) => ({ ...c, back: i === 1 ? 'Edited back' : c.back })) })
    check('a deck with no visual at all saves card edits freely', r.ok && readArt(f3).cards[1].back === 'Edited back')

    console.log('Shared decks, copies, regenerate')
    const idA = await newApprovedLesson(), idB = await newApprovedLesson()
    for (const id of [idA, idB]) { setMode('ok'); await api('POST', `${L}/${id}/text/generate`) }
    const accept = async (lid, ref) => { const b = (await lessonOf(lid)).lesson.blocks.find(x => x.artifact_type === 'flip-card-deck' && x.state === 'proposed'); return api('POST', `${L}/${lid}/blocks/${b.id}/artifact`, { mode: 'existing', source: PRIMARY, artifact: ref }) }
    await accept(idA, f1); await accept(idB, f1)
    check('usage names both lessons', (await get(f1)).data.usage.length === 2)
    const pe = payloadOf(readArt(f1)); pe.cards[1].front = 'SHARED EDIT front'
    await put(f1, pe)
    check('an edit shows in every lesson that uses the deck', (await lessonOf(idA)).artifacts[`${PRIMARY}/${f1}`].cards[1].front === 'SHARED EDIT front' && (await lessonOf(idB)).artifacts[`${PRIMARY}/${f1}`].cards[1].front === 'SHARED EDIT front')
    const blockA = (await lessonOf(idA)).lesson.blocks.find(b => b.artifact_type === 'flip-card-deck' && b.state === 'ready')
    r = await api('POST', `${L}/${idA}/blocks/${blockA.id}/artifact/copy`, {})
    const nb = r.data.lesson.blocks.find(b => b.id === blockA.id)
    check('"make a copy for this lesson" copies a deck too, keeping edited', r.ok && nb.ref.artifact !== f1 && readArt(nb.ref.artifact).edited === true && readArt(nb.ref.artifact).copied_from.artifact === f1)
    const pc = payloadOf(readArt(nb.ref.artifact)); pc.cards[0].front = 'ONLY THIS LESSON'
    await put(nb.ref.artifact, pc)
    check('editing the copy leaves the other lesson alone', (await lessonOf(idB)).artifacts[`${PRIMARY}/${f1}`].cards[0].front !== 'ONLY THIS LESSON')
    const blockB = (await lessonOf(idB)).lesson.blocks.find(b => b.artifact_type === 'flip-card-deck' && b.state === 'ready')
    r = await api('POST', `${L}/${idB}/blocks/${blockB.id}/artifact`, { mode: 'new' })
    check('regenerating makes a new deck; the edited one stays in the project', r.ok && r.data.lesson.blocks.find(b => b.id === blockB.id).ref.artifact !== f1 && fs.existsSync(artDir(f1)) && readArt(f1).edited === true)

    console.log('The lesson accessibility checker and decks')
    const f4 = await newDeck()
    const legacy = readArt(f4); delete legacy.alt_text; writeArt(f4, legacy)
    const idC = await newApprovedLesson(); setMode('ok'); await api('POST', `${L}/${idC}/text/generate`); await accept(idC, f4)
    let rep = (await api('GET', `${L}/${idC}/a11y`)).data.issues.filter(i => i.rule === 'deck-missing-alt-text')
    check('a deck with a visual and no alt text is flagged, and its Fix now opens the editor', rep.length === 1 && rep[0].fix === 'edit', rep)
    await put(f4, { alt_text: 'The diagram shows the idea.' })
    check('after the author adds alt text in the editor the warning is gone', (await api('GET', `${L}/${idC}/a11y`)).data.issues.filter(i => i.rule === 'deck-missing-alt-text').length === 0)

    console.log('Draft alt text for a saved deck (saves nothing)')
    const snap = JSON.stringify(readArt(f1))
    r = await api('POST', `${A}/${PRIMARY}/${f1}/alt-text/draft`, { visual: 'A diagram of the changeover matrix with the longest cell circled.' })
    check('returns a draft with alt text and, for a diagram, a long description', r.ok && /^DRAFT-ALT A diagram o/.test(r.data.draft.alt_text) && /DRAFT-LONG/.test(r.data.draft.long_description), r)
    check('NOTHING was saved', JSON.stringify(readArt(f1)) === snap)
    check('an empty brief is refused', (await api('POST', `${A}/${PRIMARY}/${f1}/alt-text/draft`, { visual: ' ' })).errorType === 'validation')
    check('an unknown deck → not_found', (await api('POST', `${A}/${PRIMARY}/nope-1/alt-text/draft`, { visual: 'x' })).errorType === 'not_found')
    setMode('notjson'); r = await api('POST', `${A}/${PRIMARY}/${f1}/alt-text/draft`, { visual: 'A diagram.' }); setMode('ok')
    check('a model failure → a plain error, nothing changed', r.errorType === 'malformed_json' && JSON.stringify(readArt(f1)) === snap)

    console.log('Card notes (advisory)')
    const { checkCard, wordCount } = await import(path.join(REPO, 'frontend', 'src', 'lib', 'cardChecks.mjs'))
    const ids = notes => notes.map(n => n.id)
    check('a clean card has no notes', checkCard({ front: 'Which step comes first?', back: 'List the changeover minutes.' }).length === 0)
    check('a front that states the answer is noted', ids(checkCard({ front: 'List the changeover minutes first before you build the schedule', back: 'List the changeover minutes first.' })).includes('front-gives-away-back'))
    check('a front that contains the whole back is noted', ids(checkCard({ front: 'Remember: ask an open question every single time', back: 'Ask an open question' })).includes('front-gives-away-back'))
    check('a front over 20 words is noted, with its count', (() => { const n = checkCard({ front: Array.from({ length: 25 }, (_, i) => `w${i}`).join(' '), back: 'ok' }); return ids(n).includes('front-long') && /25 words/.test(n.find(x => x.id === 'front-long').message) })())
    check('a back over 25 words is noted', ids(checkCard({ front: 'Q?', back: Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ') })).includes('back-long'))
    check('exactly 20 and 25 words are fine', checkCard({ front: Array.from({ length: 20 }, (_, i) => `w${i}`).join(' '), back: Array.from({ length: 25 }, (_, i) => `x${i}`).join(' ') }).filter(n => /long/.test(n.id)).length === 0)
    check('"see the previous card" is noted', ids(checkCard({ front: 'Use the idea from the previous card', back: 'Apply it' })).includes('other-card'))
    const dup = [{ front: 'Same front?', back: 'a' }, { front: 'same front?', back: 'b' }]
    check('duplicate fronts are noted', ids(checkCard(dup[0], dup)).includes('duplicate-front'))
    const numbered = [{ front: 'front 1', back: 'a' }, { front: 'front 2', back: 'b' }]
    check('fronts that differ only by a number are not duplicates', !ids(checkCard(numbered[0], numbered)).includes('duplicate-front'))
    check('wordCount counts words', wordCount('one two  three') === 3 && wordCount('  ') === 0)
  } finally {
    await h.stopEnv()
  }
  h.finish()
}
main().catch(e => { console.error(e); process.exit(1) })
