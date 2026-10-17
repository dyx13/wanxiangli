import { Trace, type Observation, type Cut } from 'wanxiangli/trace'

const trace = new Trace('typed-trace')
const before: Cut = trace.head()
const message: Observation = { type: 'MessageObserved', messageId: 'user', role: 'user', origin: 'human', runId: null }
trace.capture(message)
trace.capture({ type: 'PartConfirmed', messageId: 'user', partId: 'text', index: 0, kind: 'text', bytes: new Uint8Array([1]) })
trace.capture({ type: 'MessageFinished', messageId: 'user', partCount: 1 })
const restored = new Trace('typed-trace', trace.records())
const window = restored.materialize(before, trace.head())
const original: Uint8Array = window.originals[0].parts[0].content.bytes
const text: string | null = window.originals[0].parts[0].content.text
void original
void text
const confirmed: Observation = { type: 'MaterialConfirmed', identity: 'actual-part', role: 'assistant', kind: 'reasoning', providerRun: null, toolName: null, chunk: 0, chunks: 1, bytes: new Uint8Array([1]) }
trace.capture(confirmed)
const captured: Uint8Array | undefined = trace.material('actual-part', trace.head())?.content.bytes
void captured
trace.capture({ ...confirmed, identity: 'terminal', providerRun: 'actual-run' })
trace.capture({ type: 'TerminalBound', identity: 'terminal', providerRun: 'actual-run', frontier: trace.head() })
// @ts-expect-error 历史是数据，不是要注入的服务。
new Trace('invalid', { read: () => [], append: () => ({}) })
// @ts-expect-error 未确认的流式候选不是轨迹词表。
trace.capture({ type: 'PartDelta', messageId: 'user', text: 'draft' })
// @ts-expect-error 用户原件输入是字节，不接受隐式字符串转换。
trace.capture({ type: 'Opening', bytes: 'original' })
// @ts-expect-error provider 消息必须有明确 runId。
trace.capture({ type: 'MessageObserved', messageId: 'a', role: 'assistant', origin: 'provider', runId: null })
// @ts-expect-error 人类原文只能声明 user 角色。
trace.capture({ type: 'MessageObserved', messageId: 's', role: 'system', origin: 'human', runId: null })
// @ts-expect-error 未知结果不是已完成事实。
trace.capture({ type: 'RunFinished', runId: 'r', outcome: 'Unknown' })
// @ts-expect-error 游标值不能替代绑定轨迹与摘要的边界。
trace.read(0, trace.head())
// @ts-expect-error 材料分片序号是整数，不接受字符串。
trace.capture({ ...confirmed, chunk: '0' })
// @ts-expect-error Terminal 仍须绑定真实运行，不能缺失。
trace.capture({ type: 'TerminalBound', identity: 'terminal', providerRun: null, frontier: trace.head() })
