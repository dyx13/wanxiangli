import { SupervisedProcess, type SupervisedState } from 'wanxiangli/supervision'
import { ProcessSession, type ProcessOptions, type CapturedOutput } from 'wanxiangli/process'

declare const options: ProcessOptions
const run = new SupervisedProcess(options)
const state: SupervisedState = run.inspect()
const supervisorPid: number | null = state.supervisor.pid
const capture: 'Open' | 'Closed' | 'Failed' | 'Discarded' = state.capture
const output: CapturedOutput = await run.takeOutput()
if (output.kind === 'Chunk') {
  const bytes: Uint8Array = output.bytes
  const cursor: number = output.to
  void bytes
  void cursor
}
await run.started()
await run.write(new Uint8Array([65]))
run.endInput()
run.signal('SIGTERM')
const waited = await run.wait(1000)
const closedSupervisorPid: number | null = waited.state.supervisor.pid
run.discardOutput()
void supervisorPid
void closedSupervisorPid
void capture

// @ts-expect-error 监管默认提供 Capture，不接受第二套输出模式。
new SupervisedProcess(options, 'Capture')
// @ts-expect-error 缺预算不表示无限预算。
new SupervisedProcess({ executable: '/bin/true', args: [], cwd: '/tmp', env: {} })
// @ts-expect-error 字符串不是输入字节。
run.write('text')
// @ts-expect-error 未承诺任意信号。
run.signal('SIGUSR1')
// @ts-expect-error 不暴露原生句柄。
run.child.kill()
// @ts-expect-error inspect 不能由调用方修改权威事实。
state.supervisor.pid = 1
// @ts-expect-error 基础 tail 模式没有 Capture 消费方法。
new ProcessSession(options).takeOutput()
