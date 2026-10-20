/** Pure writer retention; no clock, file, deletion or projection capability. */
export interface RetainedWriter {
  readonly lastActivityMs: number
}

export type TailClassification =
  | { kind: 'observed'; observedAtMs: number }
  | { kind: 'cutTail' }
  | { kind: 'silent' }

export declare class WriterRetention {
  readonly dayMilliseconds: number
  /** UTC day number; non-finite input throws. */
  utcDay(timeMs: number): number
  /** Today and yesterday are retained; non-finite input throws. */
  isRetained(nowMs: number, lastActivityMs: number): boolean
  /** Preserves input order and returns the caller's objects. */
  retain<W extends RetainedWriter>(nowMs: number, writers: readonly W[]): W[]
  /** Only a parseable, finite string ObservedAt establishes durable activity. */
  classifyTail(line: string): TailClassification
  /** Stops at observed or silent; does not close the caller's iterator. */
  lastActivity(linesNewestFirst: Iterable<string>): number | null
}
