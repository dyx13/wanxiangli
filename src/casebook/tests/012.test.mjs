import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { CasebookIndexLaw } from 'wanxiangli/casebook'

const law = new CasebookIndexLaw()
// Frozen from the host's own CasebookIndex.shelfmarkFor (wanxiangshu master 1c43198b5 dist).
const golden = JSON.parse(readFileSync(new URL('./fixtures/host-shelfmarks.json', import.meta.url), 'utf8'))

test('SPEC[casebook-1] shelfmarks equal the frozen host vectors bit for bit', () => {
  assert.equal(golden.length, 160)
  for (const [sessionId, question, expected] of golden) {
    assert.equal(law.shelfmarkFor(sessionId, question), expected, JSON.stringify([sessionId, question]))
  }
  assert.match(law.shelfmarkFor('private-session-a', '## Restart behavior\nfull canonical question'), /^Restart behavior · [0-9a-f]{8}$/)
  assert.equal(law.compactTitle('   '), 'Untitled case')
  assert.equal(law.compactTitle('x'.repeat(73)), 'x'.repeat(71) + '…')
  assert.throws(() => law.shelfmarkFor(1, 'q'))
  assert.throws(() => law.compactTitle(null))
})

test('SPEC[casebook-1] truncation never splits a surrogate pair, so the shelfmark survives UTF-8', () => {
  for (let prefix = 66; prefix <= 72; prefix += 1) {
    const question = 'a'.repeat(prefix) + '😀😀 tail of a long question'
    const shelfmark = law.shelfmarkFor('ses_1', question)
    assert.equal(shelfmark.isWellFormed(), true, `prefix ${prefix}`)
    assert.equal(Buffer.from(shelfmark, 'utf8').toString('utf8'), shelfmark, `prefix ${prefix}`)
    assert.ok(law.compactTitle(question).length <= 72)
  }
  assert.equal(law.compactTitle('a'.repeat(70) + '😀 tail'), 'a'.repeat(70) + '…')
})

test('SPEC[casebook-2] entries expose only shelfmark and question, stably ordered, and locate the first namesake', () => {
  const cases = [
    { sessionId: 's-b', question: 'Beta' },
    { sessionId: 's-a', question: 'Alpha' },
    { sessionId: 's-c', question: 'Alpha' },
  ]
  const entries = law.entries(cases)
  assert.deepEqual(entries.map(entry => Object.keys(entry).sort()), [['question', 'shelfmark'], ['question', 'shelfmark'], ['question', 'shelfmark']])
  assert.deepEqual(entries.map(entry => entry.shelfmark), [...entries.map(entry => entry.shelfmark)].sort())
  assert.equal(JSON.stringify(entries).includes('s-a'), false)
  for (const [index, item] of cases.entries()) assert.equal(law.locate(cases, law.shelfmarkFor(item.sessionId, item.question)), index)
  assert.equal(law.locate(cases, 'missing · 00000000'), -1)
  const twins = [{ sessionId: 'x', question: 'Same' }, { sessionId: 'x', question: 'Same' }]
  assert.equal(law.locate(twins, law.shelfmarkFor('x', 'Same')), 0, 'namesakes resolve to the first in input order')
  assert.deepEqual(law.entries([]), [])
  assert.throws(() => law.entries([{ sessionId: 's' }]))
  assert.throws(() => law.locate({}, 'x'))
})

test('SPEC[casebook-3] the epoch advances only for a first snapshot, an invalidation, or a visible change', () => {
  const a = law.entries([{ sessionId: 's-a', question: 'Alpha' }, { sessionId: 's-b', question: 'Beta' }])
  const reordered = law.entries([{ sessionId: 's-b', question: 'Beta' }, { sessionId: 's-a', question: 'Alpha' }])
  assert.equal(law.advancesEpoch(null, false, a), true)
  assert.equal(law.advancesEpoch(a, false, reordered), false, 'internal case order is not a visible change')
  assert.equal(law.advancesEpoch(a, true, a), true)
  assert.equal(law.advancesEpoch(a, false, a.slice(1)), true)
  assert.equal(law.advancesEpoch(a, false, [a[0], { ...a[1], question: 'Beta!' }]), true)
  assert.equal(law.advancesEpoch(a, false, [a[1], a[0]]), true, 'a visible order change advances')
  assert.throws(() => law.advancesEpoch(a, 'no', a))
})

test('SPEC[casebook-2] frozen input stays unchanged and returned entries share no mutable data', () => {
  const cases = Object.freeze([
    Object.freeze({ sessionId: 's-b', question: 'Beta' }),
    Object.freeze({ sessionId: 's-a', question: 'Alpha' }),
  ])
  const original = JSON.stringify(cases)
  const entries = law.entries(cases)
  const snapshot = Object.freeze(entries.map(entry => Object.freeze({ ...entry })))
  entries[0].question = 'changed'
  entries.reverse()
  assert.equal(JSON.stringify(cases), original)
  assert.deepEqual(law.entries(cases), snapshot)
  assert.equal(law.advancesEpoch(snapshot, false, law.entries(cases)), false)
  assert.equal(law.locate(cases, snapshot[0].shelfmark), 1)
})

test('SPEC[casebook-2] a known historical hash collision keeps first-namesake selection', () => {
  const cases = [
    { sessionId: 'mf06-case-12096', question: 'Shared engineering question' },
    { sessionId: 'mf06-case-25875', question: 'Shared engineering question' },
  ]
  const shelfmark = 'Shared engineering question · 53e37b38'
  assert.equal(law.shelfmarkFor(cases[0].sessionId, cases[0].question), shelfmark)
  assert.equal(law.shelfmarkFor(cases[1].sessionId, cases[1].question), shelfmark)
  assert.equal(law.locate(cases, shelfmark), 0)
})
