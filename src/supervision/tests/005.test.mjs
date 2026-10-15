import test from 'node:test'
import assert from 'node:assert/strict'
import { run, ready, collect, until } from './support.mjs'

test('SPEC[supervision-005] two supervisors keep separate process groups, output and waits', async t => {
  const first = run(t, 'idle')
  const second = run(t, 'idle')
  let firstText = '', secondText = ''
  const firstOutput = collect(first, chunk => { firstText += Buffer.from(chunk.bytes).toString() })
  const secondOutput = collect(second, chunk => { secondText += Buffer.from(chunk.bytes).toString() })
  await Promise.all([ready(first), ready(second)])
  await until(() => firstText === 'ready\n' && secondText === 'ready\n')
  assert.notEqual(first.inspect().supervisor.pid, second.inspect().supervisor.pid)
  const pending = [first.wait(5000), first.wait(5000)]
  assert.equal(first.signal('SIGKILL').kind, 'Requested')
  await firstOutput
  assert.ok((await Promise.all(pending)).every(result => result.kind === 'Closed'))
  assert.equal(second.inspect().phase, 'Running')
  assert.equal((await second.wait(10)).kind, 'TimedOut')
  assert.equal(second.signal('SIGTERM').kind, 'Requested')
  assert.equal((await secondOutput).result.state.exit.signal, 'SIGTERM')
  assert.deepEqual(Object.keys(first).sort(), ['started', 'inspect', 'read', 'write', 'endInput', 'signal', 'wait', 'takeOutput', 'discardOutput'].sort())
})
