import test from 'node:test'
import assert from 'node:assert/strict'
import { WriterRetention } from 'wanxiangli/retention'

const retention = new WriterRetention()
const journal = observedAt => JSON.stringify({ event_type: 'JournalEnvelope', payload: { ObservedAt: observedAt } })
const cutTail = JSON.stringify({ event_type: 'ProjectionCutTail', payload: { rule: 'r' } })
const other = JSON.stringify({ event_type: 'JobRequested', payload: { ObservedAt: '2026-10-20T00:00:00.000Z' } })
const pulled = lines => {
  const seen = []
  const iterable = {
    *[Symbol.iterator]() {
      for (const line of lines) {
        seen.push(line)
        yield line
      }
    },
  }
  return { iterable, seen }
}

test('WHAT[durable-convergence-011] the newest Journal ObservedAt is writer activity', () => {
  const at = '2026-10-19T23:59:59.999Z'
  assert.equal(retention.lastActivity([journal(at), journal('2026-10-01T00:00:00.000Z')]), Date.parse(at))
  assert.deepEqual(retention.classifyTail(journal(at)), { kind: 'observed', observedAtMs: Date.parse(at) })
})

test('WHAT[durable-convergence-011] cut-tail chains walk across the caller supplied segment seam and stop', () => {
  const at = '2026-10-18T12:00:00.000Z'
  const { iterable, seen } = pulled([cutTail, cutTail, journal(at), journal('2026-10-20T00:00:00.000Z')])
  assert.equal(retention.lastActivity(iterable), Date.parse(at))
  assert.equal(seen.length, 3)
  assert.deepEqual(retention.classifyTail(cutTail), { kind: 'cutTail' })
})

test('WHAT[durable-convergence-011] other tail lines stop before an older Journal observation', () => {
  const { iterable, seen } = pulled([other, journal('2026-10-20T00:00:00.000Z')])
  assert.equal(retention.lastActivity(iterable), null)
  assert.equal(seen.length, 1)
  assert.deepEqual(retention.classifyTail(other), { kind: 'silent' })
})

test('WHAT[durable-convergence-011] exhausted cut-tail chains and empty streams have no durable activity', () => {
  assert.equal(retention.lastActivity([cutTail, cutTail]), null)
  assert.equal(retention.lastActivity([]), null)
})

test('WHAT[durable-convergence-011] unusable observations are silent instead of coerced dates', () => {
  const silent = ['not json', 'null', '[]', JSON.stringify({ event_type: 'JournalEnvelope' }),
    JSON.stringify({ event_type: 'JournalEnvelope', payload: null }),
    JSON.stringify({ event_type: 'JournalEnvelope', payload: {} }), journal('not a date'),
    ...[0, 2027, 1760918400000, true, ['2027'], {}].map(journal),
    JSON.stringify({ event_type: 42, payload: { ObservedAt: '2026-10-20T00:00:00.000Z' } })]
  for (const line of silent) {
    assert.deepEqual(retention.classifyTail(line), { kind: 'silent' }, line)
    assert.equal(retention.lastActivity([line, journal('2026-10-20T00:00:00.000Z')]), null, line)
  }
})

test('WHAT[durable-convergence-011] non-iterables and non-string lines are rejected', () => {
  assert.throws(() => retention.lastActivity(undefined), /iterable/)
  assert.throws(() => retention.lastActivity([cutTail, 7]), /string/)
  assert.throws(() => retention.classifyTail(7), /string/)
})
