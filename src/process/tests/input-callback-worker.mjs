import assert from 'node:assert/strict'
import { drainMicrotasks } from 'bun:jsc'
import { setTimeout as delay } from 'node:timers/promises'
import { ProcessSession } from 'wanxiangli/process'

const mode = process.argv[2]
assert.ok(mode === 'success' || mode === 'exit')
const original = Bun.spawn
let native
let sink
let release
let reportExit
Bun.spawn = (command, options) => {
  native = original(command, options)
  sink = native.stdin
  reportExit = () => options.onExit(native, 23, null)
  return {
    pid: native.pid,
    stdin: {
      write(bytes) {
        return Promise.resolve(sink.write(bytes)).then(() => sink.flush()).then(() => new Promise(resolve => {
          release = () => resolve(bytes.length)
        }))
      },
      flush: () => sink.flush(),
      end: () => sink.end(),
    },
  }
}
let run
try {
  run = new ProcessSession({ executable: '/bin/cat', args: [], cwd: '/tmp', env: {}, tailBytes: 64, maxWriteBytes: 64 })
} finally {
  Bun.spawn = original
}
try {
  assert.equal((await run.started()).kind, 'Started')
  let inNativeCallback = false
  let reentered = false
  let replies = 0
  const pending = run.write(Buffer.from('one input')).then(result => {
    replies++
    reentered = inNativeCallback
    return result
  })
  const deadline = performance.now() + 2000
  while (!release && performance.now() < deadline) await delay(1)
  assert.ok(release, 'the real input bytes did not reach the held native acknowledgement')
  inNativeCallback = true
  release()
  drainMicrotasks()
  inNativeCallback = false
  if (mode === 'exit') {
    assert.equal(native.exitCode, null)
    reportExit()
  }
  const result = await pending
  assert.equal(reentered, false, 'the caller resumed inside the native callback checkpoint')
  assert.equal(result.kind, mode === 'exit' ? 'Unknown' : 'Written')
  await new Promise(setImmediate)
  assert.equal(replies, 1)
  if (mode === 'exit') assert.equal(run.inspect().stdin, 'Failed')
  if (mode === 'success') run.endInput()
  else await sink.end()
  assert.equal((await run.wait(2000)).kind, 'Closed')
  assert.equal(run.read('stdout', 0).text, 'one input')
  console.log(JSON.stringify({ mode, reentered, write: result.kind }))
} finally {
  if (native.exitCode === null && native.signalCode === null) native.kill('SIGKILL')
  await native.exited
  await run.wait(2000)
}
