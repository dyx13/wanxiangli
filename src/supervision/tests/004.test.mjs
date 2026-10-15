import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, rmSync, statSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { run, ready, collect, until, kill } from './support.mjs'

function controlDirectory(marker) {
  return readdirSync(tmpdir()).filter(name => name.startsWith('wanxiangli-supervision-'))
    .map(name => path.join(tmpdir(), name)).find(directory => {
      try { return JSON.parse(readFileSync(path.join(directory, 'request'), 'utf8')).env.MARKER === marker }
      catch { return false }
    })
}

test('SPEC[supervision-004] unexpected worker death preserves unknown target exit', async t => {
  const session = run(t, 'idle')
  let text = ''
  const collected = collect(session, chunk => { text += Buffer.from(chunk.bytes).toString() })
  const pid = await ready(session)
  t.after(() => kill(pid))
  await until(() => text === 'ready\n')
  kill(session.inspect().supervisor.pid)
  const output = await collected
  assert.equal(output.result.kind, 'Closed')
  assert.equal(output.result.state.exit, null)
  assert.equal(output.result.state.failure.code, 'UNKNOWN_TARGET_EXIT')
  assert.equal(output.result.state.supervisor.exit.signal, 'SIGKILL')
})

test('SPEC[supervision-004] lost private control channel is failure and never target exit zero', async t => {
  const marker = `control-${process.pid}-${Date.now()}`
  const session = run(t, 'idle', { env: { MARKER: marker } })
  const collected = collect(session)
  await ready(session)
  const directory = controlDirectory(marker)
  assert.ok(directory)
  assert.equal(statSync(directory).mode & 0o777, 0o700)
  rmSync(directory, { recursive: true, force: true })
  const output = await collected
  assert.equal(output.result.kind, 'Closed')
  assert.equal(output.result.state.exit, null)
  assert.equal(output.result.state.failure.operation, 'control')
})

test('SPEC[supervision-004] a failed worker exit-fact write kills its live group and keeps the target status unknown', async t => {
  const marker = `write-${process.pid}-${Date.now()}`
  const session = run(t, 'idle', { env: { MARKER: marker } })
  let text = ''
  const collected = collect(session, chunk => { text += Buffer.from(chunk.bytes).toString() })
  await ready(session)
  await until(() => text === 'ready\n')
  const directory = controlDirectory(marker)
  assert.ok(directory)
  mkdirSync(path.join(directory, 'exit.pending'))
  assert.equal(session.signal('SIGTERM').kind, 'Requested')
  const output = await collected
  assert.equal(output.result.kind, 'Closed')
  assert.equal(output.result.state.exit, null)
  assert.equal(output.result.state.failure.code, 'UNKNOWN_TARGET_EXIT')
  assert.equal(output.result.state.supervisor.exit.signal, 'SIGKILL')
})
