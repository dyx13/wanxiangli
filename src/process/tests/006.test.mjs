import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { ProcessSession } from 'wanxiangli/process'
import { options, ready, closed } from './support.mjs'

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

test('SPEC[process-006] native output errors settle a waiting consumer without fabricating exit', async t => {
  const original = childProcess.spawn
  let child
  childProcess.spawn = (...args) => {
    child = original(...args)
    return child
  }
  syncBuiltinESMExports()
  let run
  try {
    run = capture(t, 'idle')
  } finally {
    childProcess.spawn = original
    syncBuiltinESMExports()
  }
  await ready(run)
  await run.takeOutput()
  const pending = run.takeOutput()
  child.stdout.destroy(Object.assign(new Error('capture read failed'), { code: 'EIO' }))
  const result = await pending
  assert.equal(result.kind, 'Failed')
  assert.equal(result.error.code, 'EIO')
  assert.equal(run.inspect().exit, null)
  result.error.message = 'rewritten'
  assert.equal((await run.takeOutput()).error.message, 'capture read failed')
})
