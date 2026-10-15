export interface AppendResult {
  status: 'Committed' | 'Replayed' | 'Conflict' | 'NotWritten' | 'Unknown';
  revision: number;
  reason: string | null;
}
export interface SqliteStatement {
  get(...parameters: any[]): unknown;
  all(...parameters: any[]): unknown[];
  run(...parameters: any[]): unknown;
  /** 不提供 finalize 时，连接的 close 必须释放该 statement。 */
  finalize?(): void;
}
export interface SqliteConnection {
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatement;
  close(): unknown;
}
export interface SqliteJournal {
  read(stream: string): string[];
  append(stream: string, expectedRevision: number, requestId: string, body: string): AppendResult;
  close(): void;
}
export const SqliteJournal: { new(connection: SqliteConnection): SqliteJournal };
