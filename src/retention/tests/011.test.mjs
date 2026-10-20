import test from 'node:test'
import assert from 'node:assert/strict'
import { WriterRetention } from 'wanxiangli/retention'

const retention = new WriterRetention()
const day = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 9, 20, 15, 30)
const today = Date.UTC(2026, 9, 20)

test('WHAT[durable-convergence-011] today and yesterday are retained; the day before is collected', () => {
  assert.equal(retention.isRetained(now, now), true)
  assert.equal(retention.isRetained(now, today), true)
  assert.equal(retention.isRetained(now, today - day), true)
  assert.equal(retention.isRetained(now, today - day - 1), false)
  assert.equal(retention.isRetained(now, today - 3 * day), false)
})

test('WHAT[durable-convergence-011] the cut-off is a calendar day, not a rolling 24 hours', () => {
  const lastActivity = today - day
  assert.equal(retention.isRetained(today + 1, lastActivity), true)
  assert.equal(retention.isRetained(today + day - 1, lastActivity), true)
  assert.equal(retention.isRetained(today + day, lastActivity), false)
  assert.equal(retention.utcDay(today + day - 1), retention.utcDay(today))
})

test('WHAT[durable-convergence-011] new activity moves a writer to a later day', () => {
  assert.equal(retention.isRetained(now, today - 5 * day), false)
  assert.equal(retention.isRetained(now, now - 1000), true)
})

test('WHAT[durable-convergence-011] retain distributes over union and returns caller objects in order', () => {
  let state = 7
  const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x100000000
  for (let run = 0; run < 300; run += 1) {
    const writers = Array.from({ length: 1 + Math.floor(next() * 12) }, (_, index) => ({
      writerId: `writer-${run}-${index}`, lastActivityMs: now - Math.floor(next() * 4 * day),
    }))
    const split = Math.floor(next() * writers.length)
    const union = retention.retain(now, writers)
    assert.deepEqual(union, [...retention.retain(now, writers.slice(0, split)), ...retention.retain(now, writers.slice(split))])
    for (const writer of union) assert.ok(writers.includes(writer))
    assert.deepEqual(union, writers.filter(writer => retention.isRetained(now, writer.lastActivityMs)))
  }
})

test('WHAT[durable-convergence-011] non-finite and wrongly typed times are rejected', () => {
  for (const invalid of [NaN, Infinity, -Infinity, '1700000000000', null]) {
    assert.throws(() => retention.utcDay(invalid), /finite/)
    assert.throws(() => retention.isRetained(now, invalid), /finite/)
    assert.throws(() => retention.isRetained(invalid, now), /finite/)
    assert.throws(() => retention.retain(now, [{ lastActivityMs: invalid }]), /finite/)
  }
  assert.throws(() => retention.retain(now, 'writers'), /array/)
  assert.equal(retention.dayMilliseconds, day)
})
