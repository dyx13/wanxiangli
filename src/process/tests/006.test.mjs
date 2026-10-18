import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { stat, readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { ProcessSession } from 'wanxiangli/process'
import { options, ready, closed, temporary, until } from './support.mjs'

function capture(t, mode, args = [], overrides = {}) {
  const run = new ProcessSession(options(mode, args, overrides), 'Capture')
  t.after(async () => {
    run.signal('SIGKILL')
    run.discardOutput()
    await closed(run)
  })
  return run
}

test('SPEC[process-006] capture preserves both complete byte streams with a slow consumer', { timeout: 15000 }, async t => {
  const run = capture(t, 'flood', [], { tailBytes: 17 })
  await ready(run)
  await delay(40)
  assert.equal(run.inspect().stdout.observed, 0, 'capture must not consume bytes before a reader requests them')
  assert.equal((await run.wait(5)).kind, 'TimedOut')
  const hashes = { stdout: createHash('sha256'), stderr: createHash('sha256') }
  const lengths = { stdout: 0, stderr: 0 }
  let blocks = 0
  while (true) {
    const part = await run.takeOutput()
    if (part.kind === 'Closed') break
    assert.equal(part.kind, 'Chunk')
    assert.ok(part.bytes.length > 0 && part.bytes.length <= 65536)
    assert.equal(part.from, lengths[part.channel])
    lengths[part.channel] += part.bytes.length
    assert.equal(part.to, lengths[part.channel])
    hashes[part.channel].update(part.bytes)
    if (++blocks % 8 === 0) await delay(1)
  }
  const expectedOut = createHash('sha256')
  const expectedErr = createHash('sha256')
  for (let index = 0; index < 128; index++) expectedOut.update(Buffer.alloc(65536, 97))
  for (let index = 0; index < 16; index++) expectedErr.update(Buffer.alloc(65536, 97))
  expectedOut.update('最后的原始输出🧭\n')
  expectedErr.update('stderr-tail\n')
  assert.equal(hashes.stdout.digest('hex'), expectedOut.digest('hex'))
  assert.equal(hashes.stderr.digest('hex'), expectedErr.digest('hex'))
  assert.equal(lengths.stdout, 128 * 65536 + Buffer.byteLength('最后的原始输出🧭\n'))
  assert.equal(lengths.stderr, 16 * 65536 + Buffer.byteLength('stderr-tail\n'))
  assert.equal(run.inspect().stdout.observed, lengths.stdout)
  assert.equal(run.inspect().stderr.observed, lengths.stderr)
  assert.ok(run.inspect().stdout.retained <= 17)
  assert.deepEqual((await closed(run)).exit, { code: 0, signal: null })
})

test('SPEC[process-006] paused capture blocks the actual writer and resumes both complete channels', { timeout: 15000 }, async t => {
  const receipt = join(temporary(t), 'pressure')
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
  const run = capture(t, 'pressure', [], { args: ['-e', program, receipt], tailBytes: 0 })
  await ready(run)
  await until(() => existsSync(receipt + '.ready'), 'actual writer ready')
  await delay(250)
  assert.equal(existsSync(receipt + '.done'), false, 'paused Capture must block the actual writer, not cache all output')
  const hashes = { stdout: createHash('sha256'), stderr: createHash('sha256') }
  const lengths = { stdout: 0, stderr: 0 }
  for (;;) {
    const part = await run.takeOutput()
    if (part.kind === 'Closed') break
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
  assert.equal((await closed(run)).failure, null)
})

test('SPEC[process-006] Bun idle capture reads do not occupy the filesystem I/O pool', { skip: !globalThis.Bun, timeout: 15000 }, async t => {
  const runs = []
  const pending = []
  for (let index = 0; index < 16; index++) {
    const run = capture(t, 'idle', [], { args: ['-e', 'setInterval(() => {}, 1000)'], tailBytes: 0 })
    runs.push(run)
    await ready(run)
    pending.push(run.takeOutput())
  }
  await delay(50)
  const file = new URL('./006.test.mjs', import.meta.url)
  const result = await Promise.race([
    Promise.all([stat(file), readFile(file)]),
    delay(1000).then(() => { throw new Error('Idle capture reads blocked independent filesystem work') }),
  ])
  assert.ok(result[0].size > 0)
  assert.ok(result[1].length > 0)
  for (const run of runs) {
    run.discardOutput()
    assert.equal(run.inspect().phase, 'Running')
  }
  for (const result of await Promise.all(pending)) assert.equal(result.kind, 'Discarded')
})

test('SPEC[process-006] capture rejects overlapping readers without consuming another chunk', async t => {
  const run = capture(t, 'echo')
  await ready(run)
  const first = await run.takeOutput()
  assert.equal(first.channel, 'stderr')
  const pending = run.takeOutput()
  assert.throws(() => run.takeOutput(), /pending/)
  await run.write(Buffer.from('one chunk'))
  const chunk = await pending
  assert.equal(Buffer.from(chunk.bytes).toString(), 'one chunk')
  chunk.bytes.fill(0)
  assert.equal(run.read('stdout', 0).text, 'one chunk', 'delivered bytes cannot rewrite the private tail')
  run.endInput()
  assert.equal((await run.takeOutput()).kind, 'Closed')
})

test('SPEC[process-006] discarding capture releases a pending reader without inventing process exit', async t => {
  const run = capture(t, 'idle')
  await ready(run)
  assert.equal((await run.takeOutput()).kind, 'Chunk')
  const pending = run.takeOutput()
  run.discardOutput()
  run.discardOutput()
  assert.equal((await pending).kind, 'Discarded')
  assert.equal((await run.takeOutput()).kind, 'Discarded')
  assert.equal(run.inspect().phase, 'Running')
  run.signal('SIGKILL')
  await closed(run)
})

test('SPEC[process-006] failed startup also settles capture with the original failure', async t => {
  const run = capture(t, 'report', [], { executable: '/nonexistent-wanxiangli-capture' })
  const start = await run.started()
  assert.equal(start.kind, 'Failed')
  const result = await run.takeOutput()
  assert.equal(result.kind, 'Failed')
  assert.equal(result.error.code, 'ENOENT')
})

test('SPEC[process-006] a killed capture drains accepted bytes before its closed receipt', async t => {
  const run = capture(t, 'idle')
  await ready(run)
  const readyBytes = await run.takeOutput()
  assert.equal(Buffer.from(readyBytes.bytes).toString(), 'ready\n')
  run.signal('SIGKILL')
  assert.equal((await run.takeOutput()).kind, 'Closed')
  assert.equal(run.inspect().exit.signal, 'SIGKILL')
})

test('SPEC[process-006] killing a forwarding process reaches actual pipe EOF after all captured bytes', { timeout: 5000 }, async t => {
  const marker = join(temporary(t), 'flushed')
  const expected = {
    stdout: 8 * 1024 * 1024 + 22,
    stderr: 8 * 1024 * 1024 + 22,
  }
  const run = capture(t, 'relay-flood', [marker], { tailBytes: 0 })
  await ready(run)
  await delay(75)
  const lengths = { stdout: 0, stderr: 0 }
  while (lengths.stdout < expected.stdout || lengths.stderr < expected.stderr) {
    const part = await run.takeOutput()
    assert.equal(part.kind, 'Chunk')
    lengths[part.channel] += part.bytes.length
  }
  const pending = run.takeOutput()
  await until(() => existsSync(marker), 'forwarded pipes flushed')
  assert.equal(run.signal('SIGKILL').kind, 'Requested')
  const output = await Promise.race([
    pending,
    delay(1000).then(() => { throw new Error(`Capture did not reach EOF: ${JSON.stringify(run.inspect())}`) }),
  ])
  assert.equal(output.kind, 'Closed')
  assert.equal(output.state.exit.signal, 'SIGKILL')
})

test('SPEC[process-006] native output errors settle a waiting consumer without fabricating exit', async t => {
  const run = capture(t, 'idle')
  await ready(run)
  const original = Readable.prototype.read
  const streams = []
  Readable.prototype.read = function (size) {
    const bytes = original.call(this, size)
    if (bytes?.length) streams.push(this)
    return bytes
  }
  let first
  try {
    first = await run.takeOutput()
  } finally {
    Readable.prototype.read = original
  }
  assert.equal(first.kind, 'Chunk')
  assert.equal(first.channel, 'stdout')
  assert.equal(Buffer.from(first.bytes).toString(), 'ready\n')
  assert.equal(streams.length, 1, 'capture must reach the actual native stdout read')
  const pending = run.takeOutput()
  const observed = streams[0].emit('error', Object.assign(new Error('capture read failed'), { code: 'EIO' }))
  assert.equal(observed, true, 'the production stdout error listener must receive the injected event')
  const result = await pending
  assert.equal(result.kind, 'Failed')
  assert.equal(result.error.code, 'EIO')
  assert.equal(result.error.operation, 'stdout')
  assert.equal(run.inspect().exit, null)
  result.error.message = 'rewritten'
  assert.equal((await run.takeOutput()).error.message, 'capture read failed')
})
