export type Origin = 'human' | 'plugin' | 'host-internal' | 'provider';
export type Role = 'user' | 'assistant' | 'tool' | 'system';
export type PartKind = 'text' | 'tool-call' | 'tool-result' | 'binary';
export type Observation =
  | { type: 'Opening'; bytes: Uint8Array }
  | { type: 'OpeningBound'; messageId: string }
  | { type: 'RunStarted'; runId: string }
  | ({ type: 'MessageObserved'; messageId: string } & (
      | { role: 'user'; origin: 'human' | 'plugin' | 'host-internal'; runId: null }
      | { role: 'system'; origin: 'plugin' | 'host-internal'; runId: null }
      | { role: 'assistant' | 'tool'; origin: 'provider'; runId: string }))
  | { type: 'PartConfirmed'; messageId: string; partId: string; index: number; kind: PartKind; bytes: Uint8Array }
  | { type: 'MessageFinished'; messageId: string; partCount: number }
  | { type: 'RunFinished'; runId: string; outcome: 'Completed' | 'Failed' | 'Cancelled' }
  | ConfirmedMaterial | TerminalBinding;
export type MaterialKind = 'text' | 'reasoning' | 'tool-call' | 'tool-result' | 'media-omitted';
export type ConfirmedMaterial = {
  type: 'MaterialConfirmed'; identity: string; role: string; kind: MaterialKind;
  providerRun: string | null; toolName: string | null; chunk: number; chunks: number; bytes: Uint8Array;
};
export type TerminalBinding = { type: 'TerminalBound'; identity: string; providerRun: string; frontier: Cut };
export interface CaptureResult {
  readonly status: 'Appended' | 'Replayed';
  readonly cursor: number;
  readonly record: string;
}
export interface Cut {
  readonly traceId: string;
  readonly cursor: number;
  readonly digest: string;
}
export interface ByteContent {
  readonly bytes: Uint8Array;
  readonly text: string | null;
}
type ByteObservation = Extract<Observation, { bytes: Uint8Array }>;
export type ObservationView = Exclude<Observation, ByteObservation> | TerminalBinding
  | (Omit<ConfirmedMaterial, 'bytes'> & { readonly content: ByteContent })
  | { type: 'Opening'; content: ByteContent }
  | { type: 'PartConfirmed'; messageId: string; partId: string; index: number; kind: PartKind; content: ByteContent };
export interface MessageView {
  readonly messageId: string;
  readonly role: Role;
  readonly origin: Origin;
  readonly runId: string | null;
  readonly firstCursor: number;
  readonly finished: boolean;
  readonly parts: readonly {
    readonly partId: string; readonly index: number; readonly kind: PartKind;
    readonly cursor: number; readonly content: ByteContent;
  }[];
}
export interface TraceWindow {
  readonly after: Cut;
  readonly through: Cut;
  readonly opening: ByteContent | null;
  readonly messages: readonly MessageView[];
  readonly originals: readonly MessageView[];
  readonly statement: null | {
    readonly messageId: string;
    readonly partIds: readonly string[];
    readonly content: ByteContent;
  };
  readonly materials: readonly {
    readonly identity: string; readonly role: string; readonly kind: MaterialKind;
    readonly providerRun: string | null; readonly toolName: string | null;
    readonly firstCursor: number; readonly complete: boolean; readonly content: ByteContent;
  }[];
  readonly terminals: readonly {
    readonly identity: string; readonly providerRun: string; readonly frontier: Cut; readonly content: ByteContent;
  }[];
}
export interface Trace {
  capture(observation: Observation | ConfirmedMaterial | TerminalBinding): CaptureResult;
  inspect(): { readonly traceId: string; readonly cursor: number; readonly messages: number; readonly runs: number; readonly bytes: number };
  records(): string[];
  head(): Cut;
  cut(cursor: number): Cut;
  read(after: Cut, through: Cut): { readonly cursor: number; readonly observation: ObservationView }[];
  materialize(after: Cut, through: Cut): TraceWindow;
  material(identity: string, through: Cut): TraceWindow['materials'][number] | null;
}
export const Trace: { new(traceId: string, records?: readonly string[]): Trace };
