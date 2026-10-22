export interface NaiveSandboxRunHandle {
  readonly programPromise: Promise<string>
  readonly deadlineRef: { current: number }
}

/** The host must reset an expired deadline before resuming paused work. */
export interface SandboxRunHandle extends NaiveSandboxRunHandle {
  pause(): void
  resume(): void
}

export interface SandboxMessages {
  /**
   * Run modelSource under DONT_CONTEXTIFY + realm membrane.
   * `programPromise` resolves to the wrapper JSON string (sentinels included).
   */
  run(
    api: object,
    deadlineMs: number,
    deadlineEpochMs: number,
    baseClassSource: string,
    modelSource: string,
  ): SandboxRunHandle

  /** Pre-membrane runner — library base-red only; do not use in production. */
  runNaive(
    api: object,
    deadlineMs: number,
    baseClassSource: string,
    modelSource: string,
  ): NaiveSandboxRunHandle

  resetDeadline(deadlineRef: { current: number }, epochMs: number): void
}

export function Sandbox(): SandboxMessages
