import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { readdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { run, options, ready, collect, until, SupervisedProcess, workerFile } from './support.mjs'

test('SPEC[supervision-001] target options are validated before a worker or target is started', () => {
  for (const change of [
    { executable: 'node' }, { cwd: 'relative' }, { args: [null] }, { env: { bad: 1 } },
    { tailBytes: -1 }, { maxWriteBytes: 0 }, { extra: true },
  ]) assert.throws(() => new SupervisedProcess(options('facts', change)))
  let called = false
  const input = options('facts')
  Object.defineProperty(input, 'cwd', { get() { called = true; return tmpdir() } })
  assert.throws(() => new SupervisedProcess(input), /data field/)
  assert.equal(called, false)
})

test('SPEC[supervision-001] startup refers to the actual target and forwards explicit input unchanged', async t => {
  const session = run(t, 'facts', { args: [workerFile, 'facts', 'two words', '$(false)', ''], env: { TEST: 'only' } })
  const collected = collect(session)
  const pid = await ready(session)
  const state = session.inspect()
  assert.equal(state.pid, pid)
  assert.notEqual(state.supervisor.pid, pid)
  const output = await collected
  assert.equal(output.result.kind, 'Closed')
  const native = execFileSync(process.execPath, [workerFile, 'facts', 'two words', '$(false)', ''], { cwd: tmpdir(), env: { TEST: 'only' } })
  assert.deepEqual(JSON.parse(output.stdout.toString()), JSON.parse(native.toString()))
  assert.deepEqual(output.result.state.exit, { code: 0, signal: null })
  assert.equal(output.result.state.failure, null)
  assert.equal((await session.wait(5000)).kind, 'Closed')
})

test('SPEC[supervision-001] target ENOENT is never reported as worker startup or exit zero', async t => {
  const session = run(t, 'facts', { executable: '/missing-wanxiangli-supervision-target' })
  const start = await session.started()
  assert.equal(start.kind, 'Failed')
  assert.equal(start.error.operation, 'spawn')
  assert.equal(start.error.code, 'ENOENT')
  const end = await session.wait(5000)
  assert.equal(end.kind, 'Closed')
  assert.equal(end.state.pid, null)
  assert.equal(end.state.exit, null)
  assert.equal(end.state.failure.code, 'ENOENT')
  assert.equal(end.state.capture, 'Discarded')
})

test('SPEC[supervision-001] the final target preserves literal environment keys through both physical launches', async t => {
  const env = Object.fromEntries([['__proto__', 'literal'], ['constructor', 'data'], ['EMPTY', '']])
  const session = run(t, 'facts', { env })
  const collected = collect(session)
  await ready(session)
  const output = await collected
  assert.equal(output.result.kind, 'Closed')
  assert.deepEqual(output.result.state.exit, { code: 0, signal: null })
  const actual = JSON.parse(output.stdout.toString())
  for (const [key, value] of Object.entries(env)) assert.equal(actual.env[key], value, key)
})

test('SPEC[supervision-001] failed startup cleans its control directory and poll without a capture consumer', async () => {
  const marker = `startup-${process.pid}-${Date.now()}`
  const timerCount = process.getActiveResourcesInfo().filter(name => name === 'Timeout').length
  const session = new SupervisedProcess(options('facts', { executable: '/missing-wanxiangli-supervision-target', env: { MARKER: marker } }))
  const ownDirectory = readdirSync(tmpdir()).filter(name => name.startsWith('wanxiangli-supervision-')).find(name => {
    try { return JSON.parse(readFileSync(path.join(tmpdir(), name, 'request'), 'utf8')).env.MARKER === marker }
    catch { return false }
  })
  assert.ok(ownDirectory)
  assert.equal((await session.started()).kind, 'Failed')
  await until(() => session.inspect().phase === 'Closed')
  assert.ok(!readdirSync(tmpdir()).includes(ownDirectory))
  assert.ok(process.getActiveResourcesInfo().filter(name => name === 'Timeout').length <= timerCount)
})

test('SPEC[supervision-001] input uses real pipes and completed snapshots do not alias state', async t => {
  const session = run(t, 'echo')
  const collected = collect(session)
  await ready(session)
  const bytes = Buffer.from([0, 255, 13, 10, 65])
  assert.equal((await session.write(bytes)).kind, 'Written')
  session.endInput()
  const output = await collected
  assert.deepEqual(output.stdout, bytes)
  const first = session.inspect()
  first.exit.code = 999
  first.supervisor.exit.signal = 'bad'
  assert.equal(session.inspect().exit.code, 0)
  assert.equal(session.inspect().supervisor.exit.signal, 'SIGKILL')
})
