import type { IClockPort, ITimerPort } from '../time/index.js'

export const NodeTime: {
  nodeTimerPort(): ITimerPort
  nodeClockPort(): IClockPort
  timerTask(milliseconds: number): Promise<void>
  raceExit(exitTask: Promise<unknown>, milliseconds: number): Promise<boolean>
}
