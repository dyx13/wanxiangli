import type {
  ProcessOptions, ProcessState, OutputSlice, StartResult, WriteResult,
  SignalName, SignalResult, CapturedOutput,
} from 'wanxiangli/process';

export interface SupervisedState extends ProcessState {
  readonly capture: 'Open' | 'Closed' | 'Failed' | 'Discarded';
  readonly supervisor: {
    readonly pid: number | null;
    readonly phase: ProcessState['phase'];
    readonly exit: ProcessState['exit'];
    readonly failure: ProcessState['failure'];
  };
}
export interface SupervisedProcess {
  /** PID 属于目标；启动失败会自动清理，不要求另行消费输出。 */
  started(): Promise<StartResult>;
  inspect(): SupervisedState;
  read(channel: 'stdout' | 'stderr', after: number): OutputSlice;
  /** 回执只确认写入组长转发管道，不确认目标消费。 */
  write(bytes: Uint8Array): Promise<WriteResult>;
  endInput(): void;
  signal(name: SignalName): SignalResult;
  /** 必须继续消费或显式丢弃 Capture；Closed 仍须检查 state.failure。 */
  wait(milliseconds: number): Promise<{ kind: 'Closed' | 'TimedOut'; state: SupervisedState }>;
  takeOutput(): Promise<Exclude<CapturedOutput, { kind: 'Closed' }> | { kind: 'Closed'; state: SupervisedState }>;
  discardOutput(): void;
}
export const SupervisedProcess: { new(options: ProcessOptions): SupervisedProcess };
