import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const mode = process.argv[2]
const self = fileURLToPath(import.meta.url)
const size = 8 * 1024 * 1024 + 17
const suffix = byte => Buffer.from([0, 255, 13, 10, byte])

async function until(predicate, message) {
  const deadline = Date.now() + 5000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, message)
    await delay(5)
  }
}

function notLive(pid) {
  try { process.kill(pid, 0) } catch (error) {
    if (error.code === 'ESRCH') return true
    throw error
  }
  if (process.platform !== 'linux') return false
  try { return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].startsWith('Z ') }
  catch (error) {
    if (error.code === 'ENOENT') return true
    throw error
  }
}

async function collect(session, consume) {
  while (true) {
    const output = await session.takeOutput()
    if (output.kind !== 'Chunk') return output
    consume(output)
  }
}

async function clean(session) {
  session.signal('SIGKILL')
  session.discardOutput()
  await session.wait(5000)
}

const options = args => ({ executable: process.execPath, args, cwd: process.cwd(), env: {}, tailBytes: 0, maxWriteBytes: 65536 })

if (mode === 'flood') {
  async function write(stream, byte) {
    const block = Buffer.alloc(65521, byte)
    for (let offset = 0; offset < size; offset += block.length) {
      if (!stream.write(block.subarray(0, Math.min(block.length, size - offset)))) await once(stream, 'drain')
    }
    await new Promise(resolve => stream.write(suffix(byte), resolve))
  }
  await Promise.all([write(process.stdout, 65), write(process.stderr, 66)])
} else if (mode === 'held') {
  const child = spawn(process.execPath, [self, 'holder'], { detached: false, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: {} })
  await once(child, 'message')
  await new Promise(resolve => process.stdout.write(JSON.stringify({ descendant: child.pid }) + '\n', resolve))
  process.exit(23)
} else if (mode === 'holder') {
  process.on('SIGTERM', () => process.stderr.write('holder-term\n'))
  process.send('ready')
  setInterval(() => {}, 60000)
} else if (mode === 'base') {
  const { ProcessSession } = await import('wanxiangli/process')
  const session = new ProcessSession({ ...options(['-e', 'process.stdout.write("base-process")']), tailBytes: 64 })
  try {
    assert.equal((await session.started()).kind, 'Started')
    session.endInput()
    const closed = await session.wait(5000)
    assert.equal(closed.kind, 'Closed')
    assert.deepEqual(closed.state.exit, { code: 0, signal: null })
    assert.equal(closed.state.failure, null)
    assert.equal(session.read('stdout', 0).text, 'base-process')
  } finally {
    session.signal('SIGKILL')
  }
  console.log(JSON.stringify({ runtime: process.argv[3], baseProcess: true }))
} else if (mode === 'verify') {
  const { SupervisedProcess } = await import('wanxiangli/supervision')
  const flood = new SupervisedProcess(options([self, 'flood']))
  try {
    assert.equal((await flood.started()).kind, 'Started')
    flood.endInput()
    await delay(75)
    const hashes = { stdout: createHash('sha256'), stderr: createHash('sha256') }
    const cursors = { stdout: 0, stderr: 0 }
    const output = await collect(flood, chunk => {
      assert.ok(chunk.bytes.length > 0 && chunk.bytes.length <= 65536)
      assert.equal(chunk.from, cursors[chunk.channel])
      assert.equal(chunk.to, chunk.from + chunk.bytes.length)
      cursors[chunk.channel] = chunk.to
      hashes[chunk.channel].update(chunk.bytes)
    })
    assert.equal(output.kind, 'Closed')
    assert.deepEqual(output.state.exit, { code: 0, signal: null })
    assert.equal(output.state.failure, null)
    assert.equal(output.state.supervisor.phase, 'Closed')
    for (const [channel, byte] of [['stdout', 65], ['stderr', 66]]) {
      assert.equal(cursors[channel], size + 5)
      assert.equal(hashes[channel].digest('hex'), createHash('sha256').update(Buffer.alloc(size, byte)).update(suffix(byte)).digest('hex'))
    }
  } finally {
    await clean(flood)
  }

  const held = new SupervisedProcess(options([self, 'held']))
  let text = ''
  let errors = ''
  let descendant
  const collected = collect(held, chunk => {
    if (chunk.channel === 'stdout') {
      text += Buffer.from(chunk.bytes).toString()
      if (text.includes('\n')) descendant = JSON.parse(text.trim()).descendant
    } else errors += Buffer.from(chunk.bytes).toString()
  })
  try {
    assert.equal((await held.started()).kind, 'Started')
    held.endInput()
    await until(() => Number.isInteger(descendant) && held.inspect().exit?.code === 23, 'target exit and descendant identity')
    assert.equal(held.inspect().phase, 'Draining')
    assert.equal(held.inspect().supervisor.phase, 'Running')
    assert.equal(held.signal('SIGTERM').kind, 'Requested')
    await until(() => errors.includes('holder-term\n'), 'TERM reaches the same-group descendant')
    assert.equal((await held.wait(20)).kind, 'TimedOut')
    assert.equal(held.signal('SIGKILL').kind, 'Requested')
    const output = await collected
    assert.equal(output.kind, 'Closed')
    assert.deepEqual(output.state.exit, { code: 23, signal: null })
    assert.equal(output.state.failure, null)
    assert.equal(output.state.supervisor.phase, 'Closed')
    assert.equal((await held.wait(5000)).kind, 'Closed')
    await until(() => notLive(descendant), 'KILL terminates the same-group descendant')
    assert.equal(held.signal('SIGKILL').kind, 'NotRunning')
  } finally {
    await clean(held)
    await collected
    if (descendant && !notLive(descendant)) process.kill(descendant, 'SIGKILL')
  }
  console.log(JSON.stringify({ runtime: process.argv[3], dualOutput: true, drainingGroupSignal: true }))
} else {
  throw new Error(`Unknown consumer mode: ${mode}`)
}
