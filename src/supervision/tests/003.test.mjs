import test from 'node:test'
import assert from 'node:assert/strict'
import { run, ready, collect, until, notLive, kill } from './support.mjs'

test('SPEC[supervision-003] TERM and KILL reach the same group after target exit while a descendant holds output', async t => {
  const session = run(t, 'held')
  let text = '', errors = '', descendant
  const collected = collect(session, chunk => {
    if (chunk.channel === 'stdout') text += Buffer.from(chunk.bytes).toString()
    else errors += Buffer.from(chunk.bytes).toString()
  })
  t.after(() => { if (descendant) kill(descendant) })
  await ready(session)
  await until(() => text.includes('\n'))
  descendant = JSON.parse(text.trim()).descendant
  await until(() => session.inspect().exit?.code === 23)
  assert.equal(session.inspect().phase, 'Draining')
  assert.equal(session.inspect().supervisor.phase, 'Running')
  assert.equal(session.signal('SIGTERM').kind, 'Requested')
  await until(() => errors.includes('descendant-term\n'))
  assert.equal((await session.wait(20)).kind, 'TimedOut')
  assert.equal(session.signal('SIGKILL').kind, 'Requested')
  const output = await collected
  assert.equal(output.result.kind, 'Closed')
  assert.deepEqual(output.result.state.exit, { code: 23, signal: null })
  assert.equal(output.result.state.failure, null)
  assert.equal((await session.wait(5000)).kind, 'Closed')
  await until(() => notLive(descendant), 'descendant termination')
  assert.equal(session.signal('SIGKILL').kind, 'NotRunning')
})

test('SPEC[supervision-003] natural completion cleans same-group descendants without inherited output', async t => {
  const session = run(t, 'closed-descendant')
  let descendant
  t.after(() => { if (descendant) kill(descendant) })
  let text = ''
  const collected = collect(session, chunk => {
    if (chunk.channel === 'stdout') {
      text += Buffer.from(chunk.bytes).toString()
      if (text.includes('\n')) descendant = JSON.parse(text.trim()).descendant
    }
  })
  await ready(session)
  const output = await collected
  assert.equal(output.result.kind, 'Closed')
  assert.equal(output.result.state.exit.code, 0)
  assert.equal(output.result.state.failure, null)
  assert.ok(descendant)
  await until(() => notLive(descendant), 'descendant without output termination')
})
