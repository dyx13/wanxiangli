import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, rmSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
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

for (const [name, witness] of [
  ['legacy', { closed: true }],
  ['false', { closed: false, stdoutBytes: 0, stderrBytes: 0 }],
  ['negative', { closed: true, stdoutBytes: -1, stderrBytes: 0 }],
  ['fraction', { closed: true, stdoutBytes: 0.5, stderrBytes: 0 }],
  ['unsafe', { closed: true, stdoutBytes: Number.MAX_SAFE_INTEGER + 1, stderrBytes: 0 }],
  ['string', { closed: true, stdoutBytes: '6', stderrBytes: 0 }],
]) {
  test(`SPEC[supervision-004] ${name} output extent is control failure rather than guessed completion`, async t => {
    const marker = `bad-extent-${name}-${process.pid}-${Date.now()}`
    const session = run(t, 'idle', { env: { MARKER: marker } })
    const collected = collect(session)
    await ready(session)
    const directory = controlDirectory(marker)
    writeFileSync(path.join(directory, 'closed'), JSON.stringify(witness))
    const output = await collected
    assert.equal(output.result.kind, 'Closed')
    assert.equal(output.result.state.failure.operation, 'control')
    assert.equal(output.result.state.exit, null)
  })
}

test('SPEC[supervision-004] channel extents are checked separately even when their sum is correct', async t => {
  const marker = `swapped-extent-${process.pid}-${Date.now()}`
  const session = run(t, 'idle', { env: { MARKER: marker } })
  let observed = 0
  const collected = collect(session, chunk => { observed += chunk.bytes.length })
  await ready(session)
  await until(() => observed === 6)
  writeFileSync(path.join(controlDirectory(marker), 'closed'), JSON.stringify({ closed: true, stdoutBytes: 0, stderrBytes: 6 }))
  const output = await collected
  assert.equal(output.result.state.failure.code, 'OUTPUT_COUNT_MISMATCH')
})

for (const interrupted of [false, true]) {
  test(`SPEC[supervision-004] short Capture EOF is ${interrupted ? 'explicit interruption' : 'incomplete output'} after exact target exit`, async t => {
    const marker = `short-extent-${interrupted}-${process.pid}-${Date.now()}`
    const session = run(t, 'idle', { env: { MARKER: marker } })
    let observed = 0
    const collected = collect(session, chunk => { observed += chunk.bytes.length })
    await ready(session)
    await until(() => observed === 6)
    writeFileSync(path.join(controlDirectory(marker), 'closed'), JSON.stringify({ closed: true, stdoutBytes: 7, stderrBytes: 0 }))
    session.inspect()
    assert.equal(session.signal('SIGTERM').kind, 'Requested')
    await until(() => session.inspect().exit?.signal === 'SIGTERM')
    const waiting = session.wait(5000)
    if (interrupted) assert.equal(session.signal('SIGKILL').kind, 'Requested')
    else kill(session.inspect().supervisor.pid)
    const output = await collected
    assert.equal(output.result.state.failure.code, interrupted ? 'OUTPUT_INTERRUPTED' : 'OUTPUT_INCOMPLETE')
    assert.equal((await waiting).state.failure.code, interrupted ? 'OUTPUT_INTERRUPTED' : 'OUTPUT_INCOMPLETE')
    assert.equal(output.result.state.exit.signal, 'SIGTERM')
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
