/// 不透明 Deadline 值：只能由 deadlineCreate 构造，经 deadlineRemainingMs /
/// deadlineIsExpired / deadlineNextWaitMs 读取。
export type Deadline = unknown

export interface IDeadlineHandle {
  readonly Delay: Promise<void>
  Cancel(): void
}

export interface ITimerPort {
  /** 返回可取消的一次性截止句柄；毫秒为非负安全整数。 */
  Delay(milliseconds: number): IDeadlineHandle
  Dispose(): void
}

export interface IClockPort {
  UtcNow(): Date
}

export const Time: {
  /** JS setTimeout 的 Int32 上限；更长的等待必须分段。 */
  readonly maxTimerWaitMs: number
  /** 以 ISO 时刻与毫秒预算构造不透明截止时间。 */
  deadlineCreate(nowIso: string, budgetMs: number): Deadline
  deadlineRemainingMs(nowIso: string, deadline: Deadline): number
  deadlineIsExpired(nowIso: string, deadline: Deadline): boolean
  deadlineNextWaitMs(nowIso: string, deadline: Deadline): number
}
