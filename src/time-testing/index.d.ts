import type { IClockPort, ITimerPort } from '../time/index.js'

export interface VirtualTimerPort {
  readonly port: ITimerPort
  advance(milliseconds: number): void
  nowMs(): number
}

export interface VirtualClockPort {
  readonly port: IClockPort
  advanceMs(milliseconds: number): void
  set(value: string): void
}

export const TimeTesting: {
  virtualTimerPort(): VirtualTimerPort
  virtualClockPort(): VirtualClockPort
}
