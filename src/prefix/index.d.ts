export type Evidence =
  | { readonly kind: 'compaction'; readonly run: string }
  | { readonly kind: 'tenure'; readonly incumbencyId: string }

/** 冻结的世代状态。数组已去重并按序号排序。 */
export interface PrefixState<Epoch extends number | string = number> {
  readonly epoch: Epoch
  readonly compactionRuns: readonly string[]
  readonly tenures: readonly string[]
}

/** 一条待写入的推进行；不改变任何状态。 */
export interface Candidate<Epoch extends number | string = number> {
  readonly previousEpoch: Epoch
  readonly nextEpoch: Epoch
  readonly evidence: Evidence
}

export type CommitResult<Epoch extends number | string = number> =
  | { readonly ok: true; readonly state: PrefixState<Epoch> }
  | { readonly ok: false; readonly absorbed: true; readonly error: 'StaleEpoch'; readonly expected: Epoch; readonly actual: Epoch }
  | { readonly ok: false; readonly absorbed: true; readonly error: 'AlreadyReanchored'; readonly evidence: Evidence }
  | { readonly ok: false; readonly absorbed: false; readonly error: 'NonSequentialEpoch' }

/** 同代追加律的比较输入。messages 是调用方给出的逐条规范字节。 */
export interface Wire {
  readonly provider: string | null
  readonly model: string | null
  readonly variant: string | null
  readonly tools: readonly string[]
  readonly system: readonly string[]
  readonly messages: readonly string[]
}

export type Break = 'provider' | 'model' | 'variant' | 'tools' | 'system' | 'history-shorter' | 'history-changed'

export declare class Prefix {
  constructor()
  empty(): PrefixState
  normalize(state: PrefixState): PrefixState
  /** Decimal strings are canonical integers; outputs preserve the state's encoding. */
  normalize(state: PrefixState<string>): PrefixState<string>
  isReanchored(state: PrefixState<number | string>, evidence: Evidence): boolean
  /** Throws if new evidence would exceed the safe integer epoch range. */
  propose(state: PrefixState, evidence: Evidence): Candidate | null
  propose(state: PrefixState<string>, evidence: Evidence): Candidate<string> | null
  /** Throws if a new compaction would exceed the safe integer epoch range. */
  proposeCompaction(state: PrefixState, observedRuns: readonly string[]): Candidate | null
  proposeCompaction(state: PrefixState<string>, observedRuns: readonly string[]): Candidate<string> | null
  commit(state: PrefixState, candidate: Candidate): CommitResult
  /** State and both candidate epochs must use the same encoding. */
  commit(state: PrefixState<string>, candidate: Candidate<string>): CommitResult<string>
  appendCheckpoint(window: readonly string[], callId: string): readonly string[]
  classify(previous: Wire, next: Wire): { readonly append: boolean; readonly breaks: readonly Break[] }
}
