import test from 'node:test'
import assert from 'node:assert/strict'
import { ExecutionPermits } from '../../../dist/permit/ExecutionPermits.js'

const identity = (physical = 'physical-a') => ({
  sessionId: 'session-a', physicalUserMessageId: physical, role: 'engineer', participant: 'alice',
  target: { model: 'provider/model', reasoning: 'none' },
})
const maximum = 9223372036854775807n

test('SPEC[permit-5] adjacent bigint credits beyond Number precision remain distinct exact permits', () => {
  const owner = new ExecutionPermits()
  const first = owner.issue(identity(), 9007199254740992n)
  const second = owner.issue(identity(), 9007199254740993n)
  assert.notEqual(first, second)
  assert.equal(first.credit, 9007199254740992n)
  assert.equal(second.credit, 9007199254740993n)
  assert.equal(first.leaseId, 1n)
  assert.equal(first.fence, 1n)
  assert.equal(second.leaseId, 2n)
  assert.equal(second.fence, 2n)
  assert.equal(owner.commit(first, first.fence, identity()), 'StaleFence')
  assert.equal(owner.commit(second, second.fence, identity()), 'Applied')
})

test('SPEC[permit-5] equivalent number and bigint credits reuse the original frozen handle and encoding', () => {
  for (const [initial, repeated] of [[7, 7n], [7n, 7]]) {
    const owner = new ExecutionPermits()
    const first = owner.issue(identity(), initial)
    assert.equal(owner.issue(identity(), repeated), first)
    assert.equal(typeof first.fence, typeof initial)
    assert.equal(first.credit, initial)
    assert.ok(Object.isFrozen(first))
    assert.ok(Object.isFrozen(first.identity))
    assert.ok(Object.isFrozen(first.identity.target))
    assert.equal(owner.releaseBeforeProvider(first, first.fence, identity()), 'Applied')
    assert.equal(owner.issue(identity(), repeated), first, 'a repeat cannot resurrect a released permit')
    assert.deepEqual(owner.lifecycle(first, first.fence), { ok: true, value: 'Released' })
  }
})

test('SPEC[permit-5] credit Int64 maximum is accepted and overflow is rejected before mutation', () => {
  const owner = new ExecutionPermits()
  const first = owner.issue(identity(), maximum)
  assert.equal(first.credit, maximum)
  assert.equal(owner.issue(identity(), maximum), first)
  assert.throws(() => owner.issue(identity('wrong'), maximum + 1n), /credit/)
  assert.equal(owner.issue(identity(), maximum), first)
  assert.deepEqual(owner.lifecycle(first, first.fence), { ok: true, value: 'Pending' })
  const next = owner.issue(identity('next'), 1n)
  assert.equal(next.fence, 2n, 'rejected credit must not consume identity or replace the current permit')
})

test('SPEC[permit-5] invalid numeric and bigint credits leave the current permit unchanged', () => {
  const owner = new ExecutionPermits()
  const first = owner.issue(identity(), 1n)
  for (const credit of [9007199254740992, NaN, Infinity, -Infinity, 0, -1, 1.5, 0n, -1n, maximum + 1n, '1', null]) {
    assert.throws(() => owner.issue(identity('invalid'), credit), /credit/)
    assert.deepEqual(owner.lifecycle(first, first.fence), { ok: true, value: 'Pending' })
  }
  assert.equal(owner.issue(identity(), 1), first)
  assert.equal(owner.issue(identity('next'), 2).fence, 2)
})

test('SPEC[permit-5] fence comparison is strict and new issues select their own encoding', () => {
  const owner = new ExecutionPermits()
  const first = owner.issue(identity(), 1n)
  assert.equal(owner.commit(first, 1, identity()), 'StaleFence')
  assert.deepEqual(owner.lifecycle(first, 1).rejection, 'WrongFence')
  assert.equal(owner.commit(first, 1n, identity()), 'Applied')
  const second = owner.issue(identity('second'), 2)
  assert.equal(second.fence, 2)
  assert.equal(second.leaseId, 2)
  assert.equal(owner.commit(second, 2n, identity('second')), 'StaleFence')
  assert.equal(owner.commit(second, 2, identity('second')), 'Applied')
})

test('SPEC[permit-5] bigint permits reject forged foreign and old-physical receipts without changing the successor', () => {
  const owner = new ExecutionPermits()
  const first = owner.issue(identity(), 1n)
  const successor = owner.issue(identity('second'), 2n)
  const foreign = new ExecutionPermits().issue(identity('second'), 2n)
  assert.equal(owner.commit({ ...successor }, successor.fence, identity('second')), 'StaleFence')
  assert.equal(owner.commit(foreign, foreign.fence, identity('second')), 'StaleFence')
  assert.equal(owner.releasePhysical('session-a', 'physical-a'), 'StaleFence')
  assert.equal(owner.releaseBeforeProvider(first, first.fence, identity()), 'StaleFence')
  assert.deepEqual(owner.lifecycle(successor, successor.fence), { ok: true, value: 'Pending' })
  assert.equal(owner.commit(successor, successor.fence, identity('second')), 'Applied')
  assert.equal(owner.releaseBeforeProvider(successor, successor.fence, identity('second')), 'Conflict')
  assert.equal(owner.releasePhysical('session-a', 'second'), 'Applied')
  assert.equal(owner.releasePhysical('session-a', 'second'), 'AlreadyApplied')
})
