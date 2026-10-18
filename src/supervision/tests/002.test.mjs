import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { run, ready, collect, workerFile, until } from './support.mjs'

test('SPEC[supervision-002] paused supervision propagates backpressure through the real Worker to the target', { timeout: 15000 }, async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'wanxiangli-pressure-test-'))
  const receipt = path.join(directory, 'pressure')
  const size = 64 * 1024 * 1024
  const program = `const fs = require('node:fs');
    const bytes = Buffer.alloc(65536, 71);
    fs.writeFileSync(process.argv[1] + '.ready', '');
    for (let total = 0; total < ${size}; total += bytes.length) {
      for (const channel of [1, 2]) {
        let offset = 0;
        while (offset < bytes.length) {
          const count = fs.writeSync(channel, bytes, offset, bytes.length - offset);
          if (count <= 0) throw Error('No write progress');
          offset += count;
        }
      }
    }
    fs.writeFileSync(process.argv[1] + '.done', '');`
  const session = run(t, 'pressure', { args: ['-e', program, receipt], tailBytes: 0 })
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  await ready(session)
  await until(() => existsSync(receipt + '.ready'), 'actual target writer ready')
  await delay(250)
  assert.equal(existsSync(receipt + '.done'), false, 'all physical hops must block instead of caching the target output')
  const hashes = { stdout: createHash('sha256'), stderr: createHash('sha256') }
  const lengths = { stdout: 0, stderr: 0 }
  for (;;) {
    const part = await session.takeOutput()
    if (part.kind === 'Closed') {
      assert.equal(part.state.failure, null)
      break
    }
    assert.equal(part.kind, 'Chunk')
    assert.equal(part.from, lengths[part.channel])
    lengths[part.channel] += part.bytes.length
    assert.equal(part.to, lengths[part.channel])
    hashes[part.channel].update(part.bytes)
  }
  const expected = createHash('sha256')
  for (let index = 0; index < size / 65536; index++) expected.update(Buffer.alloc(65536, 71))
  const digest = expected.digest('hex')
  for (const channel of ['stdout', 'stderr']) {
    assert.equal(lengths[channel], size)
    assert.equal(hashes[channel].digest('hex'), digest)
  }
  assert.equal(existsSync(receipt + '.done'), true)
})

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
