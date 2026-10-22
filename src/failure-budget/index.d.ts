/**
 * wanxiangli/failure-budget — the single owner of one Logical Run's provider failure budget
 * (vibe-fs CUT-14 ②; provider-attempt-recovery, execution-failure-policy).
 *
 * Pure computation over a frozen plain state. Exact attempt deduplication (bounded window), the
 * consecutive count advances exactly once per new failure, exhaustion is terminal for the run, a
 * business-main success clears the streak, and a replayed failure is answered from the record.
 * The caller journals every fact; this package never counts by time, error text or polling.
 */
export interface FailedAttemptIdentity {
  readonly sessionId: string
  readonly logicalRun: string
  readonly authorityRoot: string
  readonly providerRun: string
}

export interface FailureBudgetState {
  readonly logicalRun: string
  readonly authorityRoot: string
  readonly consecutiveFailureCount: number
  readonly recentFailureKeys: readonly string[]
  readonly exhausted: boolean
  readonly lastTransitionWasSuccess: boolean
}

export type FailureAdvanceRejection = 'AlreadyExhausted' | 'DifferentRun' | 'AlreadyObserved' | 'InvalidTransition'

export type FailureAdvance =
  | { readonly ok: true; readonly state: FailureBudgetState }
  | { readonly ok: false; readonly rejection: FailureAdvanceRejection }

export interface RecordedBudgetSpec {
  readonly version: number
  readonly limit: number
}

export interface RecordedFailure {
  readonly key: string
  readonly count: number
  readonly reason: string
}

export interface RecordedBudgetState {
  readonly logicalRun: string
  readonly authorityRoot: string
  readonly consecutiveFailureCount: number
  readonly budgetSpec: RecordedBudgetSpec | null
  readonly observedFailures: readonly RecordedFailure[]
  readonly successKeys: readonly string[]
  readonly exhausted: boolean
  readonly lastTransitionWasSuccess: boolean
}

export type RecordedBudgetRejection = FailureAdvanceRejection | 'InvalidBudget' | 'ConflictingObservation'
export type RecordedBudgetAdvance =
  | { readonly ok: true; readonly state: RecordedBudgetState }
  | { readonly ok: false; readonly rejection: RecordedBudgetRejection }

export type RecordedFailureObservation =
  | { readonly ok: true; readonly kind: 'Record'; readonly budgetSpec: RecordedBudgetSpec;
      readonly consecutiveFailureCount: number; readonly state: RecordedBudgetState }
  | { readonly ok: true; readonly kind: 'Replay'; readonly outcome: 'RetryAuthorized' | 'RetryExhausted' | 'EpisodeSuperseded' }
  | { readonly ok: false; readonly rejection: RecordedBudgetRejection }

export declare class ProviderFailureBudget {
  readonly contractVersion: 1
  readonly defaultBudget: 12
  readonly dedupeWindow: 32
  dedupeKey(identity: FailedAttemptIdentity): string
  forAuthority(logicalRun: string, authorityRoot: string): FailureBudgetState
  applyFailure(identity: FailedAttemptIdentity, consecutiveFailureCount: number, current: FailureBudgetState): FailureAdvance
  applyExhausted(current: FailureBudgetState): FailureBudgetState
  recordSuccess(current: FailureBudgetState): FailureBudgetState
  verdict(budgetLimit: number, consecutiveFailureCount: number): 'MayRetry' | 'Exhausted'
  mayRetry(budgetLimit: number, current: FailureBudgetState): boolean
  replay(budgetLimit: number, identity: FailedAttemptIdentity, current: FailureBudgetState): 'RetryAuthorized' | 'RetryExhausted' | 'EpisodeSuperseded'
  readonly recordedContractVersion: 1
  recordedForAuthority(logicalRun: string, authorityRoot: string): RecordedBudgetState
  recordedApplyFailure(identity: FailedAttemptIdentity, spec: RecordedBudgetSpec, consecutiveFailureCount: number,
    reason: string, current: RecordedBudgetState): RecordedBudgetAdvance
  recordedApplyExhausted(finalConsecutiveFailureCount: number, current: RecordedBudgetState): RecordedBudgetAdvance
  recordedSuccess(identity: FailedAttemptIdentity, current: RecordedBudgetState): RecordedBudgetAdvance
  recordedMayRetry(current: RecordedBudgetState): boolean
  recordedObserveFailure(identity: FailedAttemptIdentity, reason: string, current: RecordedBudgetState): RecordedFailureObservation
}
