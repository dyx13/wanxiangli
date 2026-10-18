import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { session, ready, closed, until, output } from './support.mjs'

test('SPEC[process-002] large buffered input waits for flush and reaches the delayed reader once', async t => {
  const run = session(t, 'input-digest', [], { maxWriteBytes: 16777216 })
  await ready(run)
  const bytes = Buffer.alloc(33554449)
  for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251
  for (let offset = 0; offset < bytes.length; offset += 16777216) {
    const part = bytes.subarray(offset, offset + 16777216)
    assert.deepEqual(await run.write(part), { kind: 'Written', bytes: part.length })
  }
  run.endInput()
  await closed(run)
  assert.deepEqual(JSON.parse(output(run).text), {
    size: bytes.length,
    hash: createHash('sha256').update(bytes).digest('hex'),
  })
})

test('SPEC[process-002] real stdin preserves binary bytes and EOF is idempotent', async t => {
  const run = session(t, 'echo')
  await ready(run)
  const bytes = Buffer.from([0, 65, 255, 13, 10, 0xf0, 0x9f, 0x98, 0x80])
  assert.deepEqual(await run.write(bytes), { kind: 'Written', bytes: bytes.length })
  run.endInput()
  run.endInput()
  await closed(run)
  assert.deepEqual(Buffer.from(output(run).bytes), bytes)
  assert.throws(() => run.write(Buffer.from('late')), /not open/)
})

test('SPEC[process-002] pending writes own a copy and do not alias caller bytes', async t => {
  const run = session(t, 'echo', [], { tailBytes: 1048576 })
  await ready(run)
  const bytes = new Uint8Array(400000).fill(65)
  const result = run.write(bytes)
  bytes.fill(66)
  assert.equal((await result).kind, 'Written')
  run.endInput()
  await closed(run)
  assert.deepEqual(output(run).bytes, new Uint8Array(400000).fill(65))
})

test('SPEC[process-002] excess input and overlapping writes cannot form an unbounded queue', async t => {
  const run = session(t, 'partial-input', [], { maxWriteBytes: 2097152 })
  await ready(run)
  await until(() => output(run).text === 'ready\n')
  assert.throws(() => run.write(new Uint8Array(2097153).fill(66)), /maxWriteBytes/)
  let acknowledged = false
  const pending = run.write(new Uint8Array(2097152).fill(65)).then(result => { acknowledged = true; return result })
  await until(() => output(run).text === 'ready\naccepted:65\n')
  assert.equal(acknowledged, false, 'the target read part of this write but the complete write is still unacknowledged')
  assert.throws(() => run.write(new Uint8Array([1])), /pending/)
  assert.equal(run.signal('SIGKILL').kind, 'Requested')
  const result = await pending
  assert.equal(result.kind, 'Unknown')
  await closed(run)
})

test('SPEC[process-002] a broken input pipe is unknown consumption, not automatic retry', async t => {
  const run = session(t, 'broken-input', [], {
    executable: '/bin/sh', args: ['-c', 'exec 0<&-; printf "ready\\n"; exec /bin/sleep 30'],
  })
  await ready(run)
  await until(() => output(run).text === 'ready\n')
  const result = await run.write(new Uint8Array(65536).fill(65))
  assert.equal(result.kind, 'Unknown')
  assert.equal(result.error.code, 'EPIPE')
  assert.equal(run.inspect().phase, 'Running', 'the reader closed its pipe before the write while the target remains alive')
  assert.equal(run.inspect().stdin, 'Failed')
  result.error.message = 'mutated by caller'
  assert.notEqual(run.inspect().failure.message, 'mutated by caller')
  assert.throws(() => run.write(new Uint8Array([1])), /not open/)
})

test('SPEC[process-002] non-byte and shared inputs are rejected without writing', async t => {
  const run = session(t, 'echo')
  await ready(run)
  for (const bytes of ['text', [1, 2], new Uint16Array(2), new Uint8Array(new SharedArrayBuffer(4))]) {
    assert.throws(() => run.write(bytes), /Uint8Array/)
  }
  run.endInput()
  await closed(run)
  assert.equal(output(run).to, 0)
})
