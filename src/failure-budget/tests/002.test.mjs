import test from 'node:test'
import assert from 'node:assert/strict'
import { ProviderFailureBudget } from 'wanxiangli/failure-budget'

const budget = new ProviderFailureBudget()
const identity = (providerRun, changes = {}) => ({ sessionId: 's', logicalRun: 'lr', authorityRoot: 'root', providerRun, ...changes })
const spec = { version: 1, limit: 12 }
const initial = () => budget.recordedForAuthority('lr', 'root')
const accepted = result => {
  assert.equal(result.ok, true, JSON.stringify(result))
  return result.state
}
const fail = (state, run, count, currentSpec = spec, reason = 'provider_error') =>
  budget.recordedApplyFailure(identity(run), currentSpec, count, reason, state)
const succeed = (state, run) => budget.recordedSuccess(identity(run), state)

test('SPEC[failure-budget-5] recorded budgets retain all failure and success identities across sixty streak resets', () => {
  assert.equal(budget.recordedContractVersion, 1)
  let state = initial()
  for (let attempt = 1; attempt <= 60; attempt++) {
    state = accepted(fail(state, `failure-${attempt}`, 1))
    state = accepted(succeed(state, `success-${attempt}`))
  }
  assert.equal(state.consecutiveFailureCount, 0)
  assert.equal(state.observedFailures.length, 60)
  assert.equal(state.successKeys.length, 60)
  assert.equal(fail(state, 'failure-1', 1).rejection, 'AlreadyObserved')
  assert.equal(succeed(state, 'success-1').rejection, 'AlreadyObserved')
  assert.deepEqual(state.budgetSpec, spec)
  for (const value of [state, state.budgetSpec, state.observedFailures, state.observedFailures[0], state.successKeys]) {
    assert.equal(Object.isFrozen(value), true)
  }
})

test('SPEC[failure-budget-6] an exact identity keeps its original reason count and persisted spec', () => {
  const first = accepted(fail(initial(), 'failure-1', 1))
  assert.equal(fail(first, 'failure-1', 1).rejection, 'AlreadyObserved')
  assert.equal(fail(first, 'failure-1', 2).rejection, 'ConflictingObservation')
  assert.equal(fail(first, 'failure-1', 1, spec, 'changed_reason').rejection, 'ConflictingObservation')
  for (const changed of [{ version: 1, limit: 13 }, { version: 2, limit: 12 }, { version: -1, limit: 12 }, { version: 1, limit: 0 }]) {
    assert.equal(fail(first, 'failure-1', 1, changed).rejection, 'InvalidBudget')
  }
  for (const count of [-1, 0, 3, 13]) {
    assert.equal(fail(first, 'failure-2', count).rejection, 'InvalidTransition')
  }
  const reset = accepted(succeed(first, 'success-1'))
  assert.equal(fail(reset, 'failure-2', 1, { version: 1, limit: 13 }).rejection, 'InvalidBudget')
  assert.deepEqual(first.budgetSpec, spec, 'rejected records do not mutate the original state')
})

test('SPEC[failure-budget-7] old success cannot clear a newer failure and opposite observations conflict', () => {
  const failed = accepted(fail(initial(), 'failure-1', 1))
  assert.equal(succeed(failed, 'failure-1').rejection, 'ConflictingObservation')
  const reset = accepted(succeed(failed, 'success-1'))
  assert.equal(fail(reset, 'success-1', 1).rejection, 'ConflictingObservation')
  const newer = accepted(fail(reset, 'failure-2', 1))
  assert.equal(succeed(newer, 'success-1').rejection, 'AlreadyObserved')
  assert.equal(newer.consecutiveFailureCount, 1)
  for (const changes of [{ logicalRun: 'other' }, { authorityRoot: 'other' }]) {
    assert.equal(budget.recordedSuccess(identity('success-2', changes), newer).rejection, 'DifferentRun')
    assert.equal(budget.recordedApplyFailure(identity('failure-3', changes), spec, 2, 'provider_error', newer).rejection, 'DifferentRun')
  }
})

test('SPEC[failure-budget-8] the limit failure exhausts immediately and neither missing confirmation nor late success reopens it', () => {
  const limit = { version: 1, limit: 2 }
  const first = accepted(fail(initial(), 'failure-1', 1, limit))
  const exhausted = accepted(fail(first, 'failure-2', 2, limit))
  assert.equal(exhausted.exhausted, true)
  assert.equal(budget.recordedMayRetry(exhausted), false)
  assert.equal(fail(exhausted, 'failure-3', 3, limit).rejection, 'AlreadyExhausted')
  assert.equal(fail(exhausted, 'failure-2', 2, limit).rejection, 'AlreadyObserved')
  assert.deepEqual(accepted(budget.recordedApplyExhausted(2, exhausted)), exhausted)
  assert.equal(budget.recordedApplyExhausted(1, exhausted).rejection, 'InvalidTransition')
  assert.equal(budget.recordedApplyExhausted(1, first).rejection, 'InvalidTransition')
  const lateSuccess = accepted(succeed(exhausted, 'late-success'))
  assert.equal(lateSuccess.consecutiveFailureCount, 2)
  assert.equal(lateSuccess.exhausted, true)
  assert.equal(budget.recordedMayRetry(lateSuccess), false)
  assert.deepEqual(budget.recordedObserveFailure(identity('failure-3'), 'provider_error', lateSuccess), {
    ok: true, kind: 'Replay', outcome: 'RetryExhausted',
  })
})

test('SPEC[failure-budget-9] one owner selects durable advance and replay without another host decision table', () => {
  const first = budget.recordedObserveFailure(identity('failure-1'), 'provider_error', initial())
  assert.equal(first.ok, true)
  assert.equal(first.kind, 'Record')
  assert.equal(first.consecutiveFailureCount, 1)
  assert.deepEqual(first.budgetSpec, spec)
  assert.deepEqual(first.state, accepted(fail(initial(), 'failure-1', 1)))
  assert.deepEqual(budget.recordedObserveFailure(identity('failure-1'), 'provider_error', first.state), {
    ok: true, kind: 'Replay', outcome: 'RetryAuthorized',
  })
  assert.equal(budget.recordedObserveFailure(identity('failure-1'), 'changed_reason', first.state).rejection, 'ConflictingObservation')
  const second = budget.recordedObserveFailure(identity('failure-2'), 'provider_error', first.state)
  assert.equal(second.kind, 'Record')
  assert.equal(second.consecutiveFailureCount, 2)
  assert.deepEqual(budget.recordedObserveFailure(identity('failure-1'), 'provider_error', second.state), {
    ok: true, kind: 'Replay', outcome: 'EpisodeSuperseded',
  })
  const reset = accepted(succeed(second.state, 'success-1'))
  assert.deepEqual(budget.recordedObserveFailure(identity('failure-2'), 'provider_error', reset), {
    ok: true, kind: 'Replay', outcome: 'EpisodeSuperseded',
  })
  const afterReset = budget.recordedObserveFailure(identity('failure-3'), 'provider_error', reset)
  assert.equal(afterReset.kind, 'Record')
  assert.equal(afterReset.consecutiveFailureCount, 1)
  assert.deepEqual(afterReset.budgetSpec, spec)
  assert.equal(budget.recordedObserveFailure(identity('failure-4'), 'provider_error', {
    ...afterReset.state, budgetSpec: null,
  }).rejection, 'InvalidBudget', 'missing historical spec cannot borrow the current default')
  assert.equal(budget.recordedObserveFailure(identity('failure-3'), 'provider_error', {
    ...afterReset.state, budgetSpec: null,
  }).rejection, 'InvalidBudget', 'a duplicate cannot conceal missing budget evidence')
  assert.equal(budget.recordedObserveFailure(identity('failure-3'), 'provider_error', {
    ...afterReset.state, budgetSpec: { version: 2, limit: 12 },
  }).rejection, 'InvalidBudget')
})

test('SPEC[failure-budget-10] recorded state shape is explicit and malformed input is never guessed', () => {
  const state = initial()
  assert.throws(() => budget.recordedObserveFailure(identity('failure-1'), 'reason', { ...state, observedFailures: undefined }), /observedFailures/)
  assert.throws(() => budget.recordedSuccess(identity('success-1'), { ...state, successKeys: [3] }), /successKeys/)
  assert.throws(() => budget.recordedApplyFailure(identity('failure-1'), undefined, 1, 'reason', state), /budgetSpec/)
  assert.throws(() => budget.recordedApplyFailure(identity('failure-1'), spec, 1.5, 'reason', state), /consecutiveFailureCount/)
  assert.throws(() => budget.recordedObserveFailure(identity(3), 'reason', state), /providerRun/)
  assert.throws(() => budget.recordedMayRetry({ ...state, budgetSpec: undefined }), /budgetSpec/)
})
