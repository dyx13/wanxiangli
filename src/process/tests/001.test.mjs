import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { ProcessSession } from 'wanxiangli/process'
import { options, session, ready, closed, output, temporary, workerFile } from './support.mjs'

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
