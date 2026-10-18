import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, realpathSync, closeSync, readFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { ProcessSession } from 'wanxiangli/process'
import { options, session, ready, closed, output, temporary, workerFile, until } from './support.mjs'

function nativeReport(cwd, env, args = []) {
  const result = childProcess.spawnSync(process.execPath, [workerFile, 'report', ...args], { cwd, env })
  assert.equal(result.status, 0, result.stderr.toString())
  return JSON.parse(result.stdout.toString())
}

function observeSpawn(action) {
  const original = childProcess.spawn
  const originalBun = globalThis.Bun?.spawn
  let calls = 0
  childProcess.spawn = (...args) => { calls++; return original(...args) }
  if (originalBun) globalThis.Bun.spawn = (...args) => { calls++; return originalBun(...args) }
  syncBuiltinESMExports()
  try { return { value: action(), calls } }
  finally {
    childProcess.spawn = original
    if (originalBun) globalThis.Bun.spawn = originalBun
    syncBuiltinESMExports()
  }
}

function noSpawn(action) {
  assert.equal(observeSpawn(() => assert.throws(action)).calls, 0)
}

test('SPEC[process-001] the native spawn observer reaches one actual validated launch', async t => {
  const observed = observeSpawn(() => session(t, 'report'))
  assert.equal(observed.calls, 1)
  await closed(observed.value)
})

test('SPEC[process-001] direct argv, explicit cwd and environment reach a real process unchanged', async t => {
  const cwd = temporary(t)
  const args = ['hello world', ';touch never', '$(not-a-command)', '', '用户🧭']
  const run = session(t, 'report', args, { cwd, env: { ONLY_THIS: '确切值' } })
  await ready(run)
  const state = await closed(run)
  assert.deepEqual(state.exit, { code: 0, signal: null })
  assert.equal(state.failure, null)
  const report = JSON.parse(output(run).text)
  assert.deepEqual(report.args, args)
  assert.equal(realpathSync(report.cwd), realpathSync(cwd))
  assert.deepEqual(report.env, nativeReport(cwd, { ONLY_THIS: '确切值' }, args).env)
  assert.equal(output(run, 'stderr').text, 'diagnostic\n')
})

test('SPEC[process-001] nonzero exit remains a real exit, not a spawn failure', async t => {
  const run = session(t, 'exit', ['19'])
  await ready(run)
  assert.deepEqual((await closed(run)).exit, { code: 19, signal: null })
  assert.equal(run.inspect().failure, null)
})

test('SPEC[process-001] environment property names are literal data, not prototype mutation', async t => {
  const env = Object.fromEntries([['__proto__', 'literal-value'], ['constructor', 'another-value'], ['EMPTY', '']])
  const run = session(t, 'report', [], { env })
  await closed(run)
  assert.deepEqual(JSON.parse(output(run).text).env, nativeReport(options('report').cwd, env).env)
})

test('SPEC[process-001] the actual child receives the exact environment and never inherits a host sentinel', async t => {
  const sentinel = 'WANXIANGLI_HOST_SENTINEL'
  const previous = process.env[sentinel]
  const env = Object.fromEntries([['__proto__', 'literal-value'], ['constructor', 'another-value'], ['EMPTY', '']])
  process.env[sentinel] = 'must-not-leak'
  try {
    const run = session(t, 'report', [], { env })
    await closed(run)
    const actual = JSON.parse(output(run).text).env
    assert.equal(actual[sentinel], undefined)
    for (const key of Object.keys(env)) assert.equal(actual[key], env[key])
  } finally {
    if (previous === undefined) delete process.env[sentinel]
    else process.env[sentinel] = previous
  }
})

test('SPEC[process-001] absent executable produces one failed start and no invented zero exit', async t => {
  const run = session(t, 'report', [], { executable: path.join(temporary(t), 'missing') })
  const start = await run.started()
  assert.equal(start.kind, 'Failed')
  assert.equal(start.error.code, 'ENOENT')
  assert.deepEqual(await run.started(), start)
  const state = await closed(run)
  assert.equal(state.exit, null)
  assert.equal(state.phase, 'Closed')
  assert.equal(run.signal('SIGKILL').kind, 'NotRunning')
})

test('SPEC[process-001] a partially prepared Bun output pipe fails before the target starts', { skip: !globalThis.Bun }, async t => {
  const effect = path.join(temporary(t), 'effect')
  const original = globalThis.Bun.spawn
  const originalSync = globalThis.Bun.spawnSync
  let calls = 0
  let directory
  globalThis.Bun.spawn = (...args) => {
    calls++
    return original(...args)
  }
  globalThis.Bun.spawnSync = (args, options) => {
    const result = originalSync(args, options)
    if (args[0] === '/usr/bin/mkfifo') {
      directory = options.cwd
      unlinkSync(args[2])
    }
    return result
  }
  let run
  try {
    run = new ProcessSession(options('stamp', [effect]), 'Capture')
  } finally {
    globalThis.Bun.spawn = original
    globalThis.Bun.spawnSync = originalSync
  }
  assert.equal((await run.started()).error.code, 'ENOENT')
  assert.equal((await closed(run)).exit, null)
  assert.equal(calls, 0)
  assert.equal(existsSync(effect), false)
  assert.ok(directory)
  assert.equal(existsSync(directory), false)
})

test('SPEC[process-001] a Bun parent writer close failure preserves the actual started target', { skip: !globalThis.Bun }, async t => {
  const effect = path.join(temporary(t), 'effect')
  const original = globalThis.Bun.spawn
  let native
  let calls = 0
  let run
  t.after(async () => {
    if (native && native.exitCode === null && native.signalCode === null) native.kill('SIGKILL')
    if (native) await native.exited
    if (run) {
      run.discardOutput()
      await closed(run)
    }
  })
  globalThis.Bun.spawn = (...args) => {
    calls++
    native = original(...args)
    closeSync(args[1].stdout)
    return native
  }
  try {
    run = new ProcessSession(options('stamp', [], {
      args: ['-e', "require('node:fs').appendFileSync(process.argv[1], 'x'); setInterval(() => {}, 1000)", effect],
    }), 'Capture')
  } finally {
    globalThis.Bun.spawn = original
  }
  const start = await run.started()
  assert.equal(start.kind, 'Started')
  assert.equal(start.pid, native.pid)
  await until(() => existsSync(effect), 'exactly one target effect')
  assert.equal(readFileSync(effect, 'utf8'), 'x')
  assert.equal(calls, 1)
  const captured = await run.takeOutput()
  assert.equal(captured.kind, 'Failed')
  assert.equal(captured.error.code, 'EBADF')
  assert.equal((await run.wait(10)).kind, 'TimedOut')
  assert.equal(run.inspect().exit, null)
})

test('SPEC[process-001] Bun startup cleanup failures are visible without an unhandled stream error', { skip: !globalThis.Bun }, () => {
  const fixture = new URL('./cleanup-fault-worker.mjs', import.meta.url)
  const result = childProcess.spawnSync(process.execPath, [fixture.pathname], { encoding: 'utf8', timeout: 5000 })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  const observed = JSON.parse(result.stdout)
  assert.equal(observed.started.kind, 'Failed')
  assert.equal(observed.started.error.code, 'EIO')
  assert.match(observed.started.error.message, /cleanup was not confirmed/)
  assert.equal(observed.closed.kind, 'Closed')
  assert.equal(observed.closed.state.exit, null)
  assert.deepEqual(observed.unhandled, [])
  assert.equal(observed.cleanupUnconfirmed, true)
  assert.equal(observed.probeCleaned, true)
})

const invalid = [
  ['relative executable', { executable: 'node' }],
  ['relative cwd', { cwd: '.' }],
  ['NUL argument', { args: ['a\0b'] }],
  ['bad Unicode argument', { args: ['\ud800'] }],
  ['negative capacity', { tailBytes: -1 }],
  ['fractional capacity', { tailBytes: 0.5 }],
  ['NaN capacity', { tailBytes: NaN }],
  ['unbounded capacity', { tailBytes: Infinity }],
  ['excessive capacity', { tailBytes: 16777217 }],
  ['zero write capacity', { maxWriteBytes: 0 }],
  ['fractional write capacity', { maxWriteBytes: 0.5 }],
  ['undefined env value', { env: { A: undefined } }],
  ['bad env key', { env: { 'A=B': 'value' } }],
  ['hidden shell option', { shell: true }],
  ['argument hole', { args: Array(1) }],
]
for (const [label, change] of invalid) {
  test(`SPEC[process-001] ${label} is refused before external effect`, t => {
    const effect = path.join(temporary(t), 'effect')
    noSpawn(() => new ProcessSession(options('stamp', [effect], change)))
    assert.equal(existsSync(effect), false)
  })
}

test('SPEC[process-001] accessors are rejected without evaluating them', t => {
  const effect = path.join(temporary(t), 'effect')
  const input = options('stamp', [effect])
  let reads = 0
  Object.defineProperty(input, 'tailBytes', { get() { reads++; return 64 } })
  noSpawn(() => new ProcessSession(input))
  assert.equal(reads, 0)
  assert.equal(existsSync(effect), false)
})
