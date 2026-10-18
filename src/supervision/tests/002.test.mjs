import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { run, ready, collect, workerFile, until } from './support.mjs'

test('SPEC[supervision-002] a final extent cannot authorize natural group cleanup before Capture receives each channel', async t => {
  const marker = `extent-${process.pid}-${Date.now()}`
  const session = run(t, 'flood', { args: [workerFile, 'flood', '777'], env: { MARKER: marker }, tailBytes: 0 })
  await ready(session)
  const directory = readdirSync(tmpdir()).filter(name => name.startsWith('wanxiangli-supervision-'))
    .map(name => path.join(tmpdir(), name)).find(directory => {
      try { return JSON.parse(readFileSync(path.join(directory, 'request'), 'utf8')).env.MARKER === marker }
      catch { return false }
    })
  assert.ok(directory)
  await until(() => existsSync(path.join(directory, 'closed')))
  const witness = JSON.parse(readFileSync(path.join(directory, 'closed'), 'utf8'))
  assert.equal(session.inspect().stdout.observed, 0)
  const paused = await session.wait(25)
  assert.equal(paused.kind, 'TimedOut')
  assert.equal(paused.state.supervisor.phase, 'Running')
  process.kill(paused.state.supervisor.pid, 0)
  assert.deepEqual(witness, { closed: true, stdoutBytes: 782, stderrBytes: 782 })
  const output = await collect(session)
  assert.equal(output.result.state.failure, null)
  assert.equal(output.stdout.length, 782)
  assert.equal(output.stderr.length, 782)
  assert.equal(output.result.state.supervisor.exit.signal, 'SIGKILL')
})

test('SPEC[supervision-002] zero-output and one-channel target completion do not wait for an absent channel', async t => {
  const empty = run(t, 'facts', { executable: '/usr/bin/true', args: [] })
  await ready(empty)
  const zero = await collect(empty)
  assert.equal(zero.result.state.failure, null)
  assert.equal(zero.stdout.length + zero.stderr.length, 0)
  const single = run(t, 'facts')
  await ready(single)
  const output = await collect(single)
  assert.equal(output.result.state.failure, null)
  assert.ok(output.stdout.length > 0)
  assert.equal(output.stderr.length, 0)
})

test('SPEC[supervision-002] natural exit preserves multi-MiB tails on both streams before group cleanup', async t => {
  const size = 8 * 1024 * 1024 + 17
  const session = run(t, 'flood', { args: [workerFile, 'flood', String(size)], tailBytes: 0 })
  await ready(session)
  await delay(75)
  assert.equal((await session.wait(10)).kind, 'TimedOut')
  const offsets = { stdout: 0, stderr: 0 }
  const output = await collect(session, chunk => {
    assert.ok(chunk.bytes.length <= 65536)
    assert.equal(chunk.from, offsets[chunk.channel])
    offsets[chunk.channel] = chunk.to
  })
  assert.equal(output.result.kind, 'Closed')
  for (const [channel, byte] of [['stdout', 65], ['stderr', 66]]) {
    assert.deepEqual(output[channel], Buffer.concat([Buffer.alloc(size, byte), Buffer.from([0, 255, 13, 10, byte])]))
    assert.equal(offsets[channel], size + 5)
  }
  assert.equal(output.result.state.failure, null)
  assert.deepEqual(output.result.state.exit, { code: 0, signal: null })
  assert.equal(output.result.state.supervisor.exit.signal, 'SIGKILL')
  assert.equal(output.result.state.capture, 'Closed')
  assert.equal((await session.wait(5000)).kind, 'Closed')
})
