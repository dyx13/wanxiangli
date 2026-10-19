import assert from 'node:assert/strict'
import { Time } from 'wanxiangli/time'
import { NodeTime } from 'wanxiangli/time-node'
import { TimeTesting } from 'wanxiangli/time-testing'
import { Wait } from 'wanxiangli/wait'

assert.equal(NodeTime.nodeClockPort().UtcNow() instanceof Date, true)
assert.equal(Time.deadlineRemainingMs('2026-10-19T00:00:00Z', Time.deadlineCreate('2026-10-19T00:00:00Z', 42)), 42)
const registry = Wait.createRegistry(8)
const observer = Wait.observerCapability(registry)
const descriptor = {
  waitKind: 'input', owner: Wait.owner('test', { id: 'consumer' }), subject: {},
  producer: Wait.externalProducer('test', { id: 'source' }),
  escapes: [Wait.escape('processLifetime')], source: 'package',
}
const timer = TimeTesting.virtualTimerPort()
const original = timer.port.Delay(50)
let cancelled = 0
const deadline = Object.freeze({
  Delay: original.Delay,
  Cancel() {
    cancelled += 1
    original.Cancel()
  },
})
assert.deepEqual(await Wait.untilSignalOrDeadline(observer, descriptor, deadline, () => 'ready', () => { throw Error('not needed') }), { ok: true, value: 'ready' })
assert.equal(cancelled, 1)
assert.deepEqual(Object.keys(deadline).sort(), ['Cancel', 'Delay'])
assert.equal(await Wait.awaitTask(observer, descriptor, Promise.resolve('observed')), 'observed')
const lease = Wait.observerEnter(observer, descriptor)
assert.equal(typeof lease.dispose, 'undefined')
Wait.markExit(lease, 'WaitResolved')
Wait.dispose(lease)
assert.equal(Wait.snapshot(registry).active.length, 0)
const mailbox = Wait.completionMailbox()
const interrupt = Wait.interrupt()
const pending = mailbox.waitForSignal(interrupt.wait)
interrupt.signal('UserMessageArrived')
assert.deepEqual(await pending, { LocalInterrupt: 'UserMessageArrived' })
assert.equal(mailbox.pendingAgentWakeCount(), 0)
process.stdout.write('time/wait package consumer passed\n')
