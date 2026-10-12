// API: accessibility rules in prompts, alt text fields and schemas, drafts
// Run by `npm run test:a11y`. Uses a mock AI model and a throwaway HOME.
const h = require('./support/api-harness')
const { DECK, HOME, L, MOCK, P, PRIMARY, api, check, fs, lastPrompt, lastSystem, newApprovedLesson, path, prompts, setMode, startEnv, stopEnv } = h
async function main() {
  await h.startEnv({ ui: false })
  try {
    await api('GET', '/projects')
    await api('POST', '/settings', { provider: 'local', model: 'm', baseUrl: `${MOCK}/v1` })
    const lessonOf = async id => (await api('GET', `${L}/${id}`)).data.lesson
    const onDisk = id => JSON.parse(fs.readFileSync(path.join(HOME, 'Byte', 'projects', P, 'lessons', id, 'lesson.json'), 'utf-8'))
    const textFor = async m => { const id = await newApprovedLesson(); setMode(m); const r = await api('POST', `${L}/${id}/text/generate`); setMode('ok'); return { id, r } }

    console.log('System prompt: Accessibility Rules')
    await newApprovedLesson()
    const A = await textFor('ok')
    const sys = lastSystem()
    check('system prompt has an ACCESSIBILITY RULES section (WCAG 2.2 AA, ATAG 2.0 Part B)', /ACCESSIBILITY RULES \(WCAG 2\.2 AA, ATAG 2\.0 Part B\)/.test(sys))
    for (const [name, re] of [
      ['visual notes need alt_text or decorative with a reason', /"alt_text":[\s\S]*125 characters or fewer[\s\S]*"decorative": true and give\s+"decorative_reason"/],
      ['long_description only for complex visuals', /"long_description" \(optional\): only for a diagram, flow, chart, or\s+comparison/],
      ['no meaning by color, position, or shape alone', /No meaning by color, position, or shape alone\. Never write "the green\s+option", "the button on the left"/],
      ['chunk titles are real headings', /A chunk title is a real heading that names its one idea/],
      ['grade 8 and spell out acronyms on first use', /Grade 8 reading level or lower\. Spell out an acronym\s+the first time you use it/],
      ['no "click here"', /Never\s+"click here", "read more", or "this link"/],
      ['feedback makes sense read aloud on its own', /must make sense when read aloud on its own/],
    ]) check('rule present: ' + name, re.test(sys), sys.slice(sys.indexOf('ACCESSIBILITY RULES'), sys.indexOf('ACCESSIBILITY RULES') + 200))
    check('the accessibility rules are listed as always winning over style guide, instructions, and block context', /The accessibility rules in this prompt always win too\. No style guide, custom instruction, per-generation prompt, or block context can switch them off\./.test(sys.replace(/\s+/g, ' ')))
    check('the section sits before the design principles', sys.indexOf('ACCESSIBILITY RULES (') < sys.indexOf('2026 MODERN LEARNING DESIGN PRINCIPLES'))

    console.log('Prompts and schemas ask for alt text')
    await newApprovedLesson(); const a2 = await newApprovedLesson(); await api('POST', `${L}/${a2}/text/generate`)
    const textP = prompts.filter(p => /^Write the text of a lesson/.test(p)).pop()
    check('lesson text prompt asks for alt_text and long_description on chunks', /Give every visual an "alt_text"/.test(textP) && /"alt_text": "string \(chunk blocks only; 125 characters or fewer\)"/.test(textP) && /"long_description"/.test(textP))
    const tabsId = (await lessonOf(A.id)); 
    const withTabs = await newApprovedLesson(); setMode('text_with_tabs'); await api('POST', `${L}/${withTabs}/text/generate`); setMode('ok')
    const tl = await lessonOf(withTabs); const tabsBlock = tl.blocks.find(b => b.kind === 'tabs')
    r = await api('POST', `${L}/${withTabs}/blocks/${tabsBlock.id}/tabs/generate`, { context: { count: 3 } })
    check('tabs prompt asks for alt_text per visual', /If a tab has a visual, it needs\s+an "alt_text"/.test(lastPrompt()) && /"alt_text": "string \(required when there is a visual/.test(lastPrompt()))
    const chunkId = A.r.data.lesson.blocks.find(b => b.kind === 'chunk').id
    await api('POST', `${L}/${A.id}/blocks/${chunkId}/text/generate`, {})
    check('single-block prompt asks for alt_text', /Give every visual an "alt_text"/.test(lastPrompt()) && /"alt_text": "string \(125 characters or fewer\)"/.test(lastPrompt()))
    await api('POST', `/projects/${P}/sources/${PRIMARY}/artifacts/generate`, { artifactType: 'flip-card-deck' })
    check('flip deck prompt asks for alt_text', /"alt_text": "string \(the text alternative for that visual/.test(lastPrompt()))

    console.log('Generated chunks carry alt text')
    const ch = A.r.data.lesson.blocks.filter(b => b.kind === 'chunk')
    check('every generated chunk has alt_text', ch.length === 3 && ch.every(b => typeof b.alt_text === 'string' && b.alt_text.length > 0), ch.map(b => b.alt_text))
    check('stored on disk', onDisk(A.id).blocks.filter(b => b.kind === 'chunk').every(b => b.alt_text))
    const m1 = await textFor('alt_missing')
    check('a chunk with a visual but no alt text is rejected (schema_validation); nothing is saved', m1.r.errorType === 'schema_validation' && (await lessonOf(m1.id)).status === 'approved', m1.r.errorType)
    const m2 = await textFor('alt_decorative')
    const dch = m2.r.ok && m2.r.data.lesson.blocks.filter(b => b.kind === 'chunk')[0]
    check('"decorative" with a reason is accepted and stored; no alt_text', dch && dch.decorative === true && dch.decorative_reason === 'Mood image only.' && dch.alt_text === undefined, dch)
    const m3 = await textFor('alt_decorative_noreason')
    check('"decorative" with no reason is rejected', m3.r.errorType === 'schema_validation', m3.r.errorType)
    const m4 = await textFor('alt_long')
    check('long_description is kept when given', m4.r.data.lesson.blocks.filter(b => b.kind === 'chunk')[0].long_description === 'LONG-1 first part. Second part.')

    console.log('Tabs: alt text per visual')
    r = await api('POST', `${L}/${withTabs}/blocks/${tabsBlock.id}/tabs/generate`, { context: { count: 3 } })
    const tb = r.data.lesson.blocks.find(b => b.id === tabsBlock.id)
    check('a generated tab with a visual has alt_text', tb.tabs[0].visual && tb.tabs[0].alt_text === 'TAB-ALT diagram', tb.tabs[0])
    check('tabs without a visual carry no alt fields', tb.tabs[1].alt_text === undefined && tb.tabs[1].visual === undefined)
    const put = tabs => api('PUT', `${L}/${withTabs}/blocks/${tabsBlock.id}/tabs`, { title: '', tabs })
    r = await put([{ label: 'A', body: 'a', visual: 'brief', alt_text: 'My alt', long_description: 'Long words.' }, { label: 'B', body: 'b', visual: 'brief 2', decorative: true, decorative_reason: 'Border art.' }])
    const t2 = r.data.lesson.blocks.find(b => b.id === tabsBlock.id)
    check('manual tabs save keeps alt_text and long_description', t2.tabs[0].alt_text === 'My alt' && t2.tabs[0].long_description === 'Long words.')
    check('a decorative tab keeps only its reason (alt dropped)', t2.tabs[1].decorative === true && t2.tabs[1].decorative_reason === 'Border art.' && t2.tabs[1].alt_text === undefined)
    r = await put([{ label: 'A', body: 'a', alt_text: 'orphan alt' }, { label: 'B', body: 'b' }])
    check('alt text with no visual is dropped', r.data.lesson.blocks.find(b => b.id === tabsBlock.id).tabs[0].alt_text === undefined)
    r = await put([{ label: 'A', body: 'a', visual: 'v', alt_text: 'x'.repeat(300) }, { label: 'B', body: 'b' }])
    check('FIX: a 300-character alt text SAVES (125 is a soft guide, never a block)', r.ok === true, r.userMessage)
    r = await put([{ label: 'A', body: 'a', visual: 'v', alt_text: 'x'.repeat(2001) }, { label: 'B', body: 'b' }])
    check('only an absurd one (over 2,000) is refused', r.errorType === 'validation')
    r = await put([{ label: 'A', body: 'a', visual: 'v' }, { label: 'B', body: 'b' }])
    check('a hand-written visual with no alt text still saves (the checker flags it later)', r.ok === true)
    const e1 = r.data.lesson.blocks.find(b => b.id === tabsBlock.id).edited
    r = await put([{ id: 't1', label: 'A', body: 'a', visual: 'v' }, { id: 't2', label: 'B', body: 'b' }])
    check('re-saving the same tabs does not flag a change', r.data.lesson.blocks.find(b => b.id === tabsBlock.id).edited === e1)
    r = await put([{ id: 't1', label: 'A', body: 'a', visual: 'v', alt_text: 'new alt' }, { id: 't2', label: 'B', body: 'b' }])
    check('adding only alt text counts as an edit', r.data.lesson.blocks.find(b => b.id === tabsBlock.id).edited === true)

    console.log('Chunk editing')
    const ed = (id, b, body) => api('PUT', `${L}/${id}/blocks/${b}/text`, body)
    const c0 = (await lessonOf(A.id)).blocks.filter(b => b.kind === 'chunk')[0]
    r = await ed(A.id, c0.id, { title: c0.title, body: c0.body, visual: c0.visual, alt_text: c0.alt_text })
    check('saving a chunk unchanged (with its alt text) is not an edit', r.data.lesson.blocks.find(b => b.id === c0.id).edited === false)
    r = await ed(A.id, c0.id, { title: c0.title, body: c0.body, visual: c0.visual, alt_text: 'A better alt text.', long_description: 'Part one. Part two.' })
    let cc = r.data.lesson.blocks.find(b => b.id === c0.id)
    check('alt text and long description saved; chunk marked edited', cc.alt_text === 'A better alt text.' && cc.long_description === 'Part one. Part two.' && cc.edited === true)
    r = await ed(A.id, c0.id, { title: c0.title, body: c0.body, visual: c0.visual, alt_text: 'x'.repeat(400) })
    check('a 400-character alt text saves with no error', r.ok && r.data.lesson.blocks.find(b => b.id === c0.id).alt_text.length === 400)
    r = await ed(A.id, c0.id, { title: c0.title, body: c0.body, visual: c0.visual, decorative: true, decorative_reason: 'Spacer' })
    cc = r.data.lesson.blocks.find(b => b.id === c0.id)
    check('switching to decorative removes alt_text and long_description', cc.decorative === true && cc.decorative_reason === 'Spacer' && cc.alt_text === undefined && cc.long_description === undefined, cc)
    r = await ed(A.id, c0.id, { title: c0.title, body: c0.body, visual: c0.visual, alt_text: 'Back to described.' })
    cc = r.data.lesson.blocks.find(b => b.id === c0.id)
    check('switching back removes decorative', cc.decorative === undefined && cc.decorative_reason === undefined && cc.alt_text === 'Back to described.')
    r = await ed(A.id, c0.id, { title: c0.title, body: c0.body, visual: '', alt_text: 'dangling' })
    cc = r.data.lesson.blocks.find(b => b.id === c0.id)
    check('clearing the visual clears every alt field', cc.visual === '' && cc.alt_text === undefined)
    check('limits: over 2,000 refused', (await ed(A.id, c0.id, { title: 'T', body: 'B', visual: 'v', alt_text: 'x'.repeat(2001) })).errorType === 'validation')
    r = await api('POST', `${L}/${A.id}/blocks/${c0.id}/text/generate`, { overwrite: true })
    cc = r.data.lesson.blocks.find(b => b.id === c0.id)
    check('regenerating a chunk gives it alt text and clears any old decorative flag', cc.alt_text === 'REGEN-ALT' && cc.decorative === undefined)
    r = await api('POST', `${L}/${A.id}/blocks`, { after: A.r.data.lesson.blocks[0].id, kind: 'chunk', mode: 'write', title: 'Mine', body: 'b', visual: 'v', alt_text: 'my alt', decorative: false })
    check('an inserted written chunk keeps alt_text', r.ok && r.data.lesson.blocks[1].alt_text === 'my alt')
    r = await api('POST', `${L}/${A.id}/blocks`, { after: A.r.data.lesson.blocks[0].id, kind: 'chunk', mode: 'generate', context: {} })
    check('an inserted generated chunk has alt text', r.ok && r.data.lesson.blocks[1].alt_text === 'REGEN-ALT')

    console.log('Flip deck: alt text')
    const GEN = `/projects/${P}/sources/${PRIMARY}/artifacts/generate`
    r = await api('POST', GEN, { artifactType: 'flip-card-deck' })
    check('a generated deck has alt_text', r.ok && r.data.alt_text === 'DECK-ALT', r)
    setMode('deck_no_alt')
    r = await api('POST', GEN, { artifactType: 'flip-card-deck' })
    setMode('ok')
    check('a deck with a visual but no alt text is rejected', r.errorType === 'schema_validation', r.errorType)
    check('knowledge check and scenario generation are unchanged', (await api('POST', GEN, { artifactType: 'knowledge-check' })).ok === true && (await api('POST', GEN, { artifactType: 'scenario-branching' })).ok === true)

    console.log('Draft alt text (saves nothing)')
    const dl = await lessonOf(A.id)
    const snap = JSON.stringify(onDisk(A.id))
    const dr = body => api('POST', `${L}/${A.id}/alt-text/draft`, body)
    r = await dr({ visual: 'A diagram of the changeover matrix with the longest cell circled.' })
    check('returns a draft with alt_text and, for a diagram, a long_description', r.ok && /^DRAFT-ALT A diagram o/.test(r.data.draft.alt_text) && /DRAFT-LONG/.test(r.data.draft.long_description), r)
    check('the draft prompt carries the brief and the rules (125 chars, no color or position, grade 8)', /A diagram of the changeover matrix/.test(lastPrompt()) && /125 characters or fewer/.test(lastPrompt()) && /Never say "left", "right", "above", or a color/.test(lastPrompt()) && /Grade 8 reading level/.test(lastPrompt()))
    r = await dr({ visual: 'A photo of a handshake.' })
    check('a simple visual gets no long description', r.ok && r.data.draft.alt_text && r.data.draft.long_description === undefined, r.data)
    check('NOTHING is saved by a draft: lesson file byte-for-byte unchanged', JSON.stringify(onDisk(A.id)) === snap)
    check('an empty brief is refused', (await dr({ visual: '  ' })).errorType === 'validation')
    setMode('notjson')
    r = await dr({ visual: 'A diagram.' })
    setMode('ok')
    check('a model failure → plain error, nothing changed', r.errorType === 'malformed_json' && JSON.stringify(onDisk(A.id)) === snap)
    check('unknown lesson → not_found', (await api('POST', `${L}/nope/alt-text/draft`, { visual: 'x' })).errorType === 'not_found')

  } finally {
    await h.stopEnv()
  }
  h.finish()
}
main().catch(e => { console.error(e); process.exit(1) })
