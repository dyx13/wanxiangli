import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { SupervisedProcess } from '../../../dist/supervision/SupervisedProcess.js'

export { SupervisedProcess }
export const workerFile = fileURLToPath(new URL('./worker.mjs', import.meta.url))
export function options(mode, overrides = {}) {
  return {
    executable: process.execPath, args: [workerFile, mode], cwd: tmpdir(), env: {},
    tailBytes: 65536, maxWriteBytes: 1048576, ...overrides,
  }
}
export function run(t, mode, overrides = {}) {
  const session = new SupervisedProcess(options(mode, overrides))
  t.after(async () => {
    await session.started()
    session.signal('SIGKILL')
    session.discardOutput()
    assert.equal((await session.wait(5000)).kind, 'Closed')
  })
  return session
}
export async function ready(session) {
  const result = await session.started()
  assert.equal(result.kind, 'Started', JSON.stringify(result))
  return result.pid
}
export async function until(observe, label = 'observation', timeout = 5000) {
  const deadline = performance.now() + timeout
  while (performance.now() < deadline) {
    const result = observe()
    if (result) return result
    await delay(5)
  }
  assert.fail(`No ${label} before deadline`)
}
export async function collect(session, onChunk = () => {}) {
  const stdout = [], stderr = []
  for (;;) {
    const result = await session.takeOutput()
    if (result.kind !== 'Chunk') {
      return { result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }
    }
    onChunk(result)
    const destination = result.channel === 'stdout' ? stdout : stderr
    destination.push(Buffer.from(result.bytes))
  }
}
export function notLive(pid) {
  try {
    if (process.platform === 'linux') {
      const state = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1)[0]
      return state === 'Z' || state === 'X'
    }
    process.kill(pid, 0)
    return false
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return true
    throw error
  }
}
export function kill(pid) {
  try { process.kill(pid, 'SIGKILL') }
  catch (error) { if (error.code !== 'ESRCH') throw error }
}
