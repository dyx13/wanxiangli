import test from 'node:test'
import assert from 'node:assert/strict'
import { Prefix } from '../../../dist/prefix/Prefix.js'

const prefix = new Prefix()
const compaction = run => ({ kind: 'compaction', run })
const tenure = incumbencyId => ({ kind: 'tenure', incumbencyId })

test('SPEC[prefix-3] a candidate is only a proposal: proposing never changes the committed state', () => {
  const state = prefix.empty()
  const before = JSON.stringify(state)
  const candidate = prefix.propose(state, compaction('c1'))
  prefix.propose(state, compaction('c2'))
  prefix.proposeCompaction(state, ['c1', 'c2', 'c3'])
  assert.equal(JSON.stringify(state), before)
  assert.equal(prefix.empty().epoch, 0)
  assert.throws(() => { candidate.nextEpoch = 7 }, TypeError, 'candidates are frozen')
  assert.throws(() => { state.compactionRuns.push('c9') }, TypeError, 'state arrays are frozen')
})

test('SPEC[prefix-3] already-committed evidence has no candidate', () => {
  const state = prefix.commit(prefix.empty(), prefix.propose(prefix.empty(), compaction('c1'))).state
  assert.equal(prefix.propose(state, compaction('c1')), null)
  assert.equal(prefix.proposeCompaction(state, ['c1']), null)
})

test('SPEC[prefix-3] the same compaction stays refused after an unrelated advance (well-formed stale decision)', () => {
  // 压缩消息永远留在宿主记录里；世代因任期交接前进后，旧压缩的新行会
  // 带着与现行世代一致的 previousEpoch 到来。只有证据集合能拒绝它。
  let state = prefix.commit(prefix.empty(), prefix.propose(prefix.empty(), compaction('c1'))).state
  state = prefix.commit(state, prefix.propose(state, tenure('inc-1'))).state
  assert.equal(state.epoch, 2)
  const forged = { previousEpoch: 2, nextEpoch: 3, evidence: compaction('c1') }
  assert.deepEqual(prefix.commit(state, forged), {
    ok: false, absorbed: true, error: 'AlreadyReanchored', evidence: compaction('c1'),
  })
})

test('SPEC[prefix-3] proposeCompaction picks the newest unhandled run, at most one', () => {
  const state = prefix.commit(prefix.empty(), prefix.propose(prefix.empty(), compaction('c1'))).state
  assert.deepEqual(prefix.proposeCompaction(state, ['c1', 'c2', 'c3']), {
    previousEpoch: 1, nextEpoch: 2, evidence: compaction('c3'),
  })
  assert.equal(prefix.proposeCompaction(state, []), null)
})

test('SPEC[prefix-3] a genuinely new compaction reanchors again and both stay recorded', () => {
  let state = prefix.empty()
  for (const run of ['c2', 'c1']) state = prefix.commit(state, prefix.propose(state, compaction(run))).state
  assert.deepEqual(state, { epoch: 2, compactionRuns: ['c1', 'c2'], tenures: [] })
})

test('SPEC[prefix-3] malformed state is refused, not defaulted', () => {
  for (const bad of [null, {}, { epoch: -1, compactionRuns: [], tenures: [] }, { epoch: 1.5, compactionRuns: [], tenures: [] },
    { epoch: 0, compactionRuns: [1], tenures: [] }, { epoch: 'zero', compactionRuns: [], tenures: [] }]) {
    assert.throws(() => prefix.propose(bad, compaction('c1')), TypeError, JSON.stringify(bad))
  }
  assert.deepEqual(prefix.normalize({ epoch: 3, compactionRuns: ['b', 'a', 'b'], tenures: [] }),
    { epoch: 3, compactionRuns: ['a', 'b'], tenures: [] })
})

test('SPEC[prefix-3] a new proposal cannot cross the safe integer epoch boundary', () => {
  const state = prefix.normalize({ epoch: Number.MAX_SAFE_INTEGER, compactionRuns: ['already'], tenures: [] })
  assert.equal(prefix.propose(state, compaction('already')), null)
  assert.throws(() => prefix.propose(state, tenure('new')), /safe successor epoch/)
  assert.throws(() => prefix.proposeCompaction(state, ['new']), /safe successor epoch/)
  assert.equal(state.epoch, Number.MAX_SAFE_INTEGER)
})

test('SPEC[prefix-3] candidates and committed states never retain mutable caller aliases', () => {
  const state = { epoch: 0, compactionRuns: [], tenures: [] }
  const evidence = tenure('inc-1')
  const candidate = prefix.propose(state, evidence)
  evidence.incumbencyId = 'inc-2'
  state.tenures.push('inc-3')
  assert.deepEqual(candidate.evidence, tenure('inc-1'))
  assert.throws(() => { candidate.evidence.incumbencyId = 'mutated' }, TypeError)
  const committed = prefix.commit(prefix.empty(), candidate)
  assert.deepEqual(committed.state, { epoch: 1, compactionRuns: [], tenures: ['inc-1'] })
  assert.throws(() => { committed.state.tenures.push('mutated') }, TypeError)
  assert.throws(() => { committed.state.epoch = 9 }, TypeError)
})

test('SPEC[prefix-3] decimal string epochs stay exact beyond the safe number range', () => {
  const state = prefix.normalize({ epoch: '9007199254740993', compactionRuns: [], tenures: [] })
  const candidate = prefix.propose(state, tenure('inc-exact'))
  assert.deepEqual(candidate, { previousEpoch: '9007199254740993', nextEpoch: '9007199254740994', evidence: tenure('inc-exact') })
  const committed = prefix.commit(state, candidate)
  assert.equal(committed.ok, true)
  assert.equal(committed.state.epoch, '9007199254740994')
  assert.equal(prefix.propose(committed.state, tenure('inc-exact')), null)
  assert.deepEqual(prefix.commit(committed.state, candidate), {
    ok: false, absorbed: true, error: 'AlreadyReanchored', evidence: tenure('inc-exact'),
  })
  assert.deepEqual(prefix.commit(committed.state, { ...candidate, evidence: compaction('new') }), {
    ok: false, absorbed: true, error: 'StaleEpoch', expected: '9007199254740994', actual: '9007199254740993',
  })
})

test('SPEC[prefix-3] exact epoch strings accept int64 boundaries without truncation', () => {
  const state = prefix.normalize({ epoch: '9223372036854775807', compactionRuns: [], tenures: [] })
  const candidate = prefix.proposeCompaction(state, ['max-compaction'])
  assert.equal(candidate.previousEpoch, '9223372036854775807')
  assert.equal(candidate.nextEpoch, '9223372036854775808')
  assert.equal(prefix.commit(state, candidate).state.epoch, '9223372036854775808')
  const zero = prefix.normalize({ epoch: '0', compactionRuns: [], tenures: [] })
  assert.deepEqual(prefix.commit(zero, { previousEpoch: '-9223372036854775808', nextEpoch: '-9223372036854775807', evidence: compaction('old') }), {
    ok: false, absorbed: true, error: 'StaleEpoch', expected: '0', actual: '-9223372036854775808',
  })
})

test('SPEC[prefix-3] epoch encoding is canonical and cannot mix within a commit', () => {
  for (const epoch of ['01', '-0', '+1', '1.0', '1e3', ' 1', '1\n', '1\r\n', '', '-1']) {
    assert.throws(() => prefix.normalize({ epoch, compactionRuns: [], tenures: [] }), TypeError)
  }
  const state = prefix.normalize({ epoch: '0', compactionRuns: [], tenures: [] })
  for (const candidate of [
    { previousEpoch: 0, nextEpoch: 1, evidence: compaction('c') },
    { previousEpoch: '0', nextEpoch: 1, evidence: compaction('c') },
    { previousEpoch: '0', nextEpoch: '01', evidence: compaction('c') },
  ]) assert.throws(() => prefix.commit(state, candidate), TypeError)
  assert.throws(() => prefix.commit(prefix.empty(), { previousEpoch: '0', nextEpoch: '1', evidence: compaction('c') }), TypeError)
  assert.deepEqual(prefix.commit(state, { previousEpoch: '0', nextEpoch: '2', evidence: compaction('c') }), {
    ok: false, absorbed: false, error: 'NonSequentialEpoch',
  })
})
