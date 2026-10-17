import test from 'node:test'
import assert from 'node:assert/strict'
import { Trace } from 'wanxiangli/trace'
import { bytes, unchanged, resign } from './support.mjs'

const material = (identity, text, extra = {}) => ({
  type: 'MaterialConfirmed', identity, role: 'assistant', kind: 'reasoning',
  providerRun: null, toolName: null, chunk: 0, chunks: 1, bytes: bytes(text), ...extra,
})
const window = trace => trace.materialize(trace.cut(0), trace.head())

test('SPEC[trace-007] observed run and tool metadata remain opaque through replay', () => {
  const trace = new Trace('opaque-metadata')
  const providerRun = 'r'.repeat(1200) + '\0\ud800'
  const toolName = 't'.repeat(1200) + '\0\ud801'
  trace.capture(material('actual-call', 'input', { kind: 'tool-call', providerRun, toolName }))
  trace.capture(material('actual-terminal', 'formal', { kind: 'text', providerRun }))
  trace.capture({ type: 'TerminalBound', identity: 'actual-terminal', providerRun, frontier: trace.cut(1) })
  const actual = window(trace)
  assert.equal(actual.materials[0].providerRun, providerRun)
  assert.equal(actual.materials[0].toolName, toolName)
  assert.equal(actual.terminals[0].providerRun, providerRun)
  assert.deepEqual(window(new Trace('opaque-metadata', trace.records())), actual)
  unchanged(trace, () => trace.capture({ type: 'RunStarted', runId: providerRun }), /identifier/i)
})

test('SPEC[trace-007] confirmed material retains missing execution evidence and exact bytes', () => {
  const trace = new Trace('confirmed')
  const input = material('g:0/msg:actual/host-part:real', '\uFEFF原件\r\n\0e\u0301')
  trace.capture(input)
  input.bytes.fill(0)
  assert.equal(trace.inspect().runs, 0)
  assert.equal(trace.inspect().messages, 0)
  assert.equal(window(trace).materials[0].providerRun, null)
  assert.equal(window(trace).materials[0].kind, 'reasoning')
  assert.equal(window(trace).materials[0].content.text, '\uFEFF原件\r\n\0e\u0301')
  assert.equal(window(trace).statement, null)
  const restored = new Trace('confirmed', trace.records())
  assert.deepEqual(window(restored), window(trace))
  assert.equal(trace.material('missing', trace.head()), null)
  assert.equal(trace.material('g:0/msg:actual/host-part:real', trace.cut(0)), null)
  assert.equal(trace.material('g:0/msg:actual/host-part:real', trace.head()).content.text, '\uFEFF原件\r\n\0e\u0301')
  assert.deepEqual(trace.read(trace.cut(0), trace.head()).map(row => row.observation.type), ['MaterialConfirmed'])
})

test('SPEC[trace-007] chunked materials interleave without changing a published prefix', () => {
  const trace = new Trace('chunks')
  const first = material('large', '', { chunks: 2, bytes: new Uint8Array([0xf0, 0x9f]) })
  trace.capture(first)
  const cut = trace.head()
  const partial = trace.materialize(trace.cut(0), cut)
  assert.equal(partial.materials[0].complete, false)
  assert.equal(partial.materials[0].content.text, null)
  trace.capture(material('tool', 'output', { kind: 'tool-result', providerRun: 'real-run' }))
  trace.capture({ ...first, chunk: 1, bytes: new Uint8Array([0xa7, 0xad]) })
  assert.equal(window(trace).materials[0].content.text, '🧭')
  assert.equal(window(trace).materials[0].complete, true)
  assert.deepEqual(trace.materialize(trace.cut(0), cut), partial)
  const selected = trace.materialize(cut, trace.head())
  assert.deepEqual(selected.materials.map(row => row.identity), ['tool'])
})

for (const change of [
  { role: 'user' }, { kind: 'text' }, { providerRun: 'invented' },
  { toolName: 'other' }, { chunks: 2 }, { bytes: bytes('changed') },
]) {
  test(`SPEC[trace-007] material identity conflict is atomic (${Object.keys(change)[0]})`, () => {
    const trace = new Trace('conflict')
    const input = material('one', 'original')
    const accepted = trace.capture(input)
    assert.equal(trace.capture(input).cursor, accepted.cursor)
    unchanged(trace, () => trace.capture({ ...input, ...change }), /conflict|tool name/i)
  })
}

test('SPEC[trace-007] chunk gaps and metadata changes do not leave an accepted fragment', () => {
  const trace = new Trace('gap')
  unchanged(trace, () => trace.capture(material('one', 'b', { chunk: 1, chunks: 2 })), /chunk/i)
  trace.capture(material('one', 'a', { chunks: 2 }))
  unchanged(trace, () => trace.capture(material('one', 'b', { chunk: 1, chunks: 3 })), /metadata|conflict/i)
  unchanged(trace, () => trace.capture(material('one', 'b', { chunk: 2, chunks: 2 })), /chunk/i)
  const corrupted = JSON.parse(trace.records()[0])
  corrupted.observation.chunk = 1
  assert.throws(() => new Trace('gap', resign([corrupted])), /chunk/i)
})

test('SPEC[trace-007] explicit terminal binds its actual run and frozen frontier', () => {
  const trace = new Trace('terminal')
  trace.capture(material('run/part', 'thinking', { providerRun: 'run-real' }))
  const frontier = trace.head()
  trace.capture(material('terminal/run-real', 'formal\r\n', { kind: 'text', providerRun: 'run-real' }))
  const binding = { type: 'TerminalBound', identity: 'terminal/run-real', providerRun: 'run-real', frontier }
  const accepted = trace.capture(binding)
  assert.equal(trace.capture(binding).cursor, accepted.cursor)
  trace.capture(material('later', 'new thought', { providerRun: 'run-next' }))
  assert.equal(window(trace).terminals[0].content.text, 'formal\r\n')
  assert.deepEqual(window(trace).terminals[0].frontier, frontier)
  assert.equal(trace.inspect().runs, 0)
  assert.deepEqual(window(new Trace('terminal', trace.records())), window(trace))
  unchanged(trace, () => trace.capture({ ...binding, frontier: trace.head() }), /conflict/i)
})

test('SPEC[trace-007] incomplete, foreign and mismatched terminal evidence is refused', () => {
  const trace = new Trace('refused')
  trace.capture(material('one', 'first', { providerRun: 'run', chunks: 2 }))
  const binding = { type: 'TerminalBound', identity: 'one', providerRun: 'run', frontier: trace.head() }
  unchanged(trace, () => trace.capture(binding), /complete/i)
  trace.capture(material('one', 'last', { providerRun: 'run', chunk: 1, chunks: 2 }))
  unchanged(trace, () => trace.capture({ ...binding, providerRun: 'other' }), /run/i)
  unchanged(trace, () => trace.capture({ ...binding, frontier: { ...binding.frontier, traceId: 'other' } }), /trace|frontier/i)
  unchanged(trace, () => trace.capture({ ...binding, frontier: { ...binding.frontier, digest: '0'.repeat(64) } }), /prefix|frontier/i)
})

test('SPEC[trace-007] every material and terminal view owns its byte copy', () => {
  const trace = new Trace('copies')
  trace.capture(material('one', 'exact', { providerRun: 'run' }))
  trace.capture({ type: 'TerminalBound', identity: 'one', providerRun: 'run', frontier: trace.head() })
  const view = window(trace)
  view.materials[0].content.bytes.fill(0)
  view.terminals[0].content.bytes.fill(0)
  view.terminals[0].frontier.digest = 'changed'
  trace.material('one', trace.head()).content.bytes.fill(0)
  assert.equal(window(trace).materials[0].content.text, 'exact')
  assert.equal(window(trace).terminals[0].content.text, 'exact')
  assert.equal(window(trace).terminals[0].frontier.digest, trace.cut(1).digest)
})
