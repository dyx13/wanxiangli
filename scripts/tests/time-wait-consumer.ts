import { Time, type IDeadlineHandle } from 'wanxiangli/time'
import { NodeTime } from 'wanxiangli/time-node'
import { TimeTesting } from 'wanxiangli/time-testing'
import { Wait, type WaitDescriptor } from 'wanxiangli/wait'

const clock: Date = NodeTime.nodeClockPort().UtcNow()
const deadline = Time.deadlineCreate(clock.toISOString(), 50)
const budget: number = Time.deadlineNextWaitMs(clock.toISOString(), deadline)
const virtual = TimeTesting.virtualTimerPort()
const handle: IDeadlineHandle = virtual.port.Delay(budget)
const registry = Wait.createRegistry(8)
const observer = Wait.observerCapability(registry)
const descriptor: WaitDescriptor = {
  waitKind: 'input',
  owner: Wait.owner('test', { id: 'consumer' }),
  subject: {},
  producer: Wait.externalProducer('test', { id: 'source' }),
  escapes: [Wait.escape('processLifetime')],
  source: 'package',
}
const lease = Wait.observerEnter(observer, descriptor)
Wait.markExit(lease, 'WaitResolved')
Wait.dispose(lease)
// @ts-expect-error 租约仅通过 Wait 函数操作，没有伪造的实例方法。
lease.dispose()
// @ts-expect-error 纯时间入口不携带虚拟构造器。
Time.virtualClockPort()
const pending: Promise<string> = Wait.awaitTask(observer, descriptor, Promise.resolve('value'))
const interruption = Wait.interrupt()
const mailbox = Wait.completionMailbox()
void mailbox.waitForSignal(interruption.wait)
const count: number = mailbox.pendingAgentWakeCount()
void [handle, pending, count]
