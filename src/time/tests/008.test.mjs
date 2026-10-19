import test from 'node:test'
import assert from 'node:assert/strict'
import { Time } from '../../../dist/time/Time.js'
import { NodeTime } from '../../../dist/time-node/NodeTime.js'
import { TimeTesting } from '../../../dist/time-testing/TimeTesting.js'

test('WHAT[TIME-CAPABILITY-008] the pure deadline surface carries no physical or virtual factory', () => {
  for (const name of ['nodeTimerPort', 'nodeClockPort', 'timerTask', 'raceExit', 'virtualTimerPort', 'virtualClockPort']) {
    assert.equal(name in Time, false, name)
  }
})

test('WHAT[TIME-CAPABILITY-008] physical and virtual clocks have independent owners', () => {
  assert.equal('virtualClockPort' in NodeTime, false)
  assert.equal('nodeClockPort' in TimeTesting, false)
  assert.equal(NodeTime.nodeClockPort().UtcNow() instanceof Date, true)
  assert.equal(TimeTesting.virtualClockPort().port.UtcNow() instanceof Date, true)
})

test('WHAT[TIME-CAPABILITY-008] deadline algebra is independent of both adapters', () => {
  // Deadline 计算不依赖物理或虚拟实现：任何时钟值都由调用方以 ISO 字符串显式给出。
  const deadline = Time.deadlineCreate('2026-10-15T00:00:00.000Z', 100)
  assert.equal(Time.deadlineRemainingMs('2026-10-15T00:00:00.000Z', deadline), 100)
})

test('WHAT[TIME-CAPABILITY-008] a physical port instance never observes the virtual clock', () => {
  const virtual = TimeTesting.virtualClockPort()
  virtual.advanceMs(100000)
  const physical = NodeTime.nodeClockPort()
  const parsed = Date.parse(physical.UtcNow())
  // 物理时钟读到的是真实系统时间（2026 年），不是虚拟游标的 2000 年原点。
  assert.ok(parsed > Date.parse('2026-01-01T00:00:00.000Z'))
})

test('WHAT[TIME-CAPABILITY-008] the module imports no sibling library', async () => {
  const source = await import('node:fs').then(fs => fs.readFileSync(new URL('../../../dist/time/Time.js', import.meta.url), 'utf8'))
  assert.doesNotMatch(source, /\bfrom\s+["']wanxiangli\//)
  assert.equal(source.includes('node:fs'), false)
  assert.equal(source.includes('node:child_process'), false)
})
