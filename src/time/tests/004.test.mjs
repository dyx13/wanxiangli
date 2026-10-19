import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Time } from '../../../dist/time/Time.js'
import { NodeTime } from '../../../dist/time-node/NodeTime.js'
import { TimeTesting } from '../../../dist/time-testing/TimeTesting.js'

test('WHAT[TIME-CAPABILITY-004] the emitted module reads no ambient wall clock', async () => {
  const source = await readFile(new URL('../../../dist/time/Time.js', import.meta.url), 'utf8')
  assert.equal(source.includes('Date.now'), false)
  assert.equal(source.includes('setTimeout'), false)
  assert.equal(source.includes('clearTimeout'), false)
})

test('WHAT[TIME-CAPABILITY-004] deadline inputs never request the ambient time, including invalid missing inputs', () => {
  const NativeDate = globalThis.Date
  globalThis.Date = class extends NativeDate {
    constructor(...args) {
      assert.notEqual(args.length, 0, 'pure time computation read the ambient clock')
      super(...args)
    }
    static now() {
      throw new Error('pure time computation read Date.now')
    }
  }
  try {
    const deadline = Time.deadlineCreate('2026-10-19T00:00:00Z', 100)
    assert.equal(Time.deadlineRemainingMs('2026-10-19T00:00:00Z', deadline), 100)
    for (const value of [undefined, null, '', '  ', 123]) {
      assert.throws(() => Time.deadlineCreate(value, 100), /explicit time string/)
    }
  } finally {
    globalThis.Date = NativeDate
  }
})

test('WHAT[TIME-CAPABILITY-004] the virtual clock ignores real elapsed time', async () => {
  const virtual = TimeTesting.virtualClockPort()
  const before = Number(virtual.port.UtcNow())
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(Number(virtual.port.UtcNow()), before)

  const timer = TimeTesting.virtualTimerPort()
  let fired = false
  const handle = timer.port.Delay(10)
  handle.Delay.then(() => { fired = true })
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(fired, false)
  timer.advance(10)
  await handle.Delay
  assert.equal(fired, true)
})

test('WHAT[TIME-CAPABILITY-004] the physical clock port is the only declared ambient reader', () => {
  const clock = NodeTime.nodeClockPort()
  assert.equal(clock.UtcNow() instanceof Date, true)
  const first = Date.parse(clock.UtcNow())
  assert.ok(Number.isFinite(first))
  const later = Date.parse(clock.UtcNow())
  assert.ok(later >= first)
})
