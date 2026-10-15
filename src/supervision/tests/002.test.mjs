import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { run, ready, collect, workerFile } from './support.mjs'

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
