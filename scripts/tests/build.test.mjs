import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, cpSync, copyFileSync, symlinkSync, rmSync, readdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))

function fixture(t, modules) {
  const directory = mkdtempSync(path.join(tmpdir(), 'wanxiangli-isolated-build-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  mkdirSync(path.join(directory, 'scripts'))
  mkdirSync(path.join(directory, 'src'))
  copyFileSync(path.join(root, 'scripts/build.mjs'), path.join(directory, 'scripts/build.mjs'))
  copyFileSync(path.join(root, 'package.json'), path.join(directory, 'package.json'))
  // 编译器是工具链；只借用工具链，不提供任何兄弟模块或旧仓源码。
  symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'junction')
  for (const name of modules) cpSync(path.join(root, 'src', name), path.join(directory, 'src', name), { recursive: true })
  if (modules.some(name => ['process', 'supervision'].includes(name))) {
    mkdirSync(path.join(directory, 'src/native-process'))
    copyFileSync(path.join(root, 'src/native-process/BunProcess.fs'), path.join(directory, 'src/native-process/BunProcess.fs'))
  }
  if (modules.some(name => ['time-node', 'time-testing'].includes(name))) {
    mkdirSync(path.join(directory, 'src/time'), { recursive: true })
    copyFileSync(path.join(root, 'src/time/Temporal.fs'), path.join(directory, 'src/time/Temporal.fs'))
  }
  return directory
}

for (const [name, probe] of [
  ['time', `import { Time } from './dist/time/Time.js'
    if (Time.deadlineNextWaitMs('2026-10-19T00:00:00Z', Time.deadlineCreate('2026-10-19T00:00:00Z', 100)) !== 100) throw Error('deadline')`],
  ['time-node', `import { NodeTime } from './dist/time-node/NodeTime.js'
    if (!(NodeTime.nodeClockPort().UtcNow() instanceof Date)) throw Error('clock')`],
  ['time-testing', `import { TimeTesting } from './dist/time-testing/TimeTesting.js'
    const clock = TimeTesting.virtualClockPort()
    const before = Number(clock.port.UtcNow())
    clock.advanceMs(42)
    if (Number(clock.port.UtcNow()) - before !== 42) throw Error('clock')`],
]) {
  test(`SPEC[build-001] ${name} compiles with no sibling implementation and runs independently`, { timeout: 60000 }, t => {
    const directory = fixture(t, [name])
    if (name !== 'time') assert.deepEqual(readdirSync(path.join(directory, 'src/time')), ['Temporal.fs'])
    succeed(run(directory, [path.join(directory, 'scripts/build.mjs'), name]))
    assert.deepEqual(readdirSync(path.join(directory, 'dist')), [name])
    succeed(run(directory, ['--input-type=module', '--eval', probe]))
  })
}

function run(directory, args) {
  const { NODE_PATH, NODE_OPTIONS, ...env } = process.env
  return spawnSync(process.execPath, args, { cwd: directory, env, encoding: 'utf8', timeout: 60000 })
}

function succeed(result) {
  assert.ifError(result.error)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
}

for (const name of ['lifecycle', 'eventstore', 'process', 'trace', 'session', 'delivery', 'degeneration', 'spool', 'pty', 'ablation', 'compression', 'sandbox', 'routing', 'projection', 'authority', 'permit', 'capacity', 'admission-queue', 'dispatch', 'borrowing', 'run-witness', 'git-porcelain', 'integration', 'failure', 'attachment-lease', 'warm-start', 'handle-lifecycle', 'failure-budget', 'delegate-batch', 'fission-group', 'ordinal', 'bayes', 'advisor']) {
  test(`SPEC[build-001] ${name} compiles and runs its own tests without any sibling owner source`, { timeout: 90000 }, t => {
    const directory = fixture(t, [name])
    assert.deepEqual(readdirSync(path.join(directory, 'src')).sort(), name === 'process' ? ['native-process', name].sort() : [name])
    const build = run(tmpdir(), [path.join(directory, 'scripts/build.mjs'), name])
    succeed(build)
    assert.doesNotMatch(build.stdout + build.stderr, /Warning:|Error:/)
    const tests = readdirSync(path.join(directory, 'src', name, 'tests'))
      .filter(file => file.endsWith('.test.mjs'))
      .map(file => path.join(directory, 'src', name, 'tests', file))
    succeed(run(directory, ['--test', ...tests]))
    assert.deepEqual(readdirSync(path.join(directory, 'dist')), [name])
    if (name === 'process') {
      const artifact = readFileSync(path.join(directory, 'dist/process/ProcessSession.js'), 'utf8')
      assert.doesNotMatch(artifact, /from ["']wanxiangli\//)
      assert.doesNotMatch(artifact, /WorkOpened|ConfirmationCommitted|journal_entries|node:sqlite|bun:sqlite/)
    }
  })
}

test('SPEC[build-001] a selected build leaves another module output untouched', { timeout: 60000 }, t => {
  const directory = fixture(t, ['lifecycle', 'eventstore'])
  const sentinel = path.join(directory, 'dist/eventstore/keep.txt')
  mkdirSync(path.dirname(sentinel), { recursive: true })
  writeFileSync(sentinel, 'not rebuilt')
  succeed(run(directory, ['scripts/build.mjs', 'lifecycle']))
  assert.equal(readFileSync(sentinel, 'utf8'), 'not rebuilt')
  assert.deepEqual(readdirSync(path.dirname(sentinel)), ['keep.txt'])
})

test('SPEC[build-001] the second cut builds without replacing any first-cut artifact', { timeout: 60000 }, t => {
  const directory = fixture(t, ['process'])
  for (const name of ['lifecycle', 'eventstore', 'assembly', 'failure']) {
    mkdirSync(path.join(directory, 'dist', name), { recursive: true })
    writeFileSync(path.join(directory, 'dist', name, 'keep.txt'), name)
  }
  succeed(run(directory, ['scripts/build.mjs', 'process']))
  for (const name of ['lifecycle', 'eventstore', 'assembly', 'failure']) {
    assert.equal(readFileSync(path.join(directory, 'dist', name, 'keep.txt'), 'utf8'), name)
    assert.deepEqual(readdirSync(path.join(directory, 'dist', name)), ['keep.txt'])
  }
})

test('SPEC[build-001] a real compiler error fails without replacing a previous artifact', { timeout: 60000 }, t => {
  const directory = fixture(t, [])
  mkdirSync(path.join(directory, 'src/broken'))
  writeFileSync(path.join(directory, 'src/broken/Broken.fsproj'), '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><Compile Include="Broken.fs" /></ItemGroup></Project>')
  writeFileSync(path.join(directory, 'src/broken/Broken.fs'), 'module Broken\nlet impossible: int = "not an integer"\n')
  mkdirSync(path.join(directory, 'dist/broken'), { recursive: true })
  writeFileSync(path.join(directory, 'dist/broken/Broken.js'), 'previous artifact')
  const result = run(directory, ['scripts/build.mjs', 'broken'])
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.equal(readFileSync(path.join(directory, 'dist/broken/Broken.js'), 'utf8'), 'previous artifact')
  assert.deepEqual(readdirSync(path.join(directory, '.build')), [])
})

test('SPEC[build-001] the third cut leaves both earlier cuts untouched and has no sibling imports', { timeout: 60000 }, t => {
  const directory = fixture(t, ['trace'])
  for (const name of ['lifecycle', 'eventstore', 'assembly', 'process', 'failure']) {
    mkdirSync(path.join(directory, 'dist', name), { recursive: true })
    writeFileSync(path.join(directory, 'dist', name, 'keep'), `unchanged-${name}`)
  }
  succeed(run(directory, ['scripts/build.mjs', 'trace']))
  for (const name of ['lifecycle', 'eventstore', 'assembly', 'process', 'failure']) {
    assert.equal(readFileSync(path.join(directory, 'dist', name, 'keep'), 'utf8'), `unchanged-${name}`)
    assert.deepEqual(readdirSync(path.join(directory, 'dist', name)), ['keep'])
  }
  assert.doesNotMatch(readFileSync(path.join(directory, 'dist/trace/Trace.js'), 'utf8'), /from ["']wanxiangli\//)
})

test('SPEC[build-001] cross-project references are rejected by the same build entrypoint', t => {
  const directory = fixture(t, [])
  mkdirSync(path.join(directory, 'src/leaky'))
  writeFileSync(path.join(directory, 'src/leaky/Leaky.fsproj'), '<Project><ItemGroup><ProjectReference Include="../legacy/Legacy.fsproj" /><Compile Include="Leaky.fs" /></ItemGroup></Project>')
  const result = run(directory, ['scripts/build.mjs', 'leaky'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /without other source projects/)
  assert.equal(existsSync(path.join(directory, 'dist/leaky')), false)
})

test('SPEC[build-001] ownership builds without the three earlier cuts and cannot import their services', { timeout: 60000 }, t => {
  const directory = fixture(t, ['session'])
  for (const name of ['lifecycle', 'eventstore', 'assembly', 'process', 'trace', 'failure']) {
    mkdirSync(path.join(directory, 'dist', name), { recursive: true })
    writeFileSync(path.join(directory, 'dist', name, 'keep'), `original-${name}`)
  }
  succeed(run(directory, ['scripts/build.mjs', 'session']))
  for (const name of ['lifecycle', 'eventstore', 'assembly', 'process', 'trace', 'failure']) {
    assert.equal(readFileSync(path.join(directory, 'dist', name, 'keep'), 'utf8'), `original-${name}`)
    assert.deepEqual(readdirSync(path.join(directory, 'dist', name)), ['keep'])
  }
  const artifact = readFileSync(path.join(directory, 'dist/session/Ownership.js'), 'utf8')
  assert.doesNotMatch(artifact, /from ["']wanxiangli\//)
  assert.doesNotMatch(artifact, /WorkOpened|ConfirmationCommitted|node:sqlite|bun:sqlite|node:child_process/)
})

test('SPEC[build-001] composition compiles without sibling sources and runs against their artifacts', { timeout: 90000 }, t => {
  const directory = fixture(t, ['assembly'])
  for (const name of ['lifecycle', 'eventstore', 'failure']) {
    cpSync(path.join(root, 'dist', name), path.join(directory, 'dist', name), { recursive: true })
  }
  const before = readFileSync(path.join(directory, 'dist/lifecycle/Work.js'), 'utf8')
  const built = run(directory, ['scripts/build.mjs', 'assembly'])
  succeed(built)
  assert.doesNotMatch(built.stdout + built.stderr, /Warning:|Error:/)
  assert.deepEqual(readdirSync(path.join(directory, 'src')), ['assembly'])
  assert.equal(readFileSync(path.join(directory, 'dist/lifecycle/Work.js'), 'utf8'), before)
  const tests = readdirSync(path.join(directory, 'src/assembly/tests'))
    .filter(file => file.endsWith('.test.mjs')).map(file => path.join(directory, 'src/assembly/tests', file))
  succeed(run(directory, ['--test', ...tests]))
  const composition = readFileSync(path.join(directory, 'dist/assembly/DurableWork.js'), 'utf8')
  assert.match(composition, /from ["']wanxiangli\/work["']/)
  assert.doesNotMatch(composition, /WorkOpened|ConfirmationCommitted|DeliveryRequested|SELECT|PRAGMA/)
})

test('SPEC[build-001] supervision compiles with only its own owner and the one shared native adapter', { timeout: 90000 }, t => {
  const directory = fixture(t, ['supervision'])
  assert.deepEqual(readdirSync(path.join(directory, 'src')).sort(), ['native-process', 'supervision'])
  assert.deepEqual(readdirSync(path.join(directory, 'src/native-process')), ['BunProcess.fs'])
  assert.equal(existsSync(path.join(directory, 'src/process')), false)
  cpSync(path.join(root, 'dist/process'), path.join(directory, 'dist/process'), { recursive: true })
  const before = readFileSync(path.join(directory, 'dist/process/ProcessSession.js'), 'utf8')
  const built = run(directory, ['scripts/build.mjs', 'supervision'])
  succeed(built)
  assert.doesNotMatch(built.stdout + built.stderr, /Warning:|Error:/)
  assert.equal(readFileSync(path.join(directory, 'dist/process/ProcessSession.js'), 'utf8'), before)
  const tests = readdirSync(path.join(directory, 'src/supervision/tests'))
    .filter(file => file.endsWith('.test.mjs')).map(file => path.join(directory, 'src/supervision/tests', file))
  succeed(run(directory, ['--test', ...tests]))
})

test('SPEC[build-001] a shared native path does not permit another cross-directory source', t => {
  const directory = fixture(t, [])
  mkdirSync(path.join(directory, 'src/process'))
  writeFileSync(path.join(directory, 'src/process/Process.fsproj'), '<Project><ItemGroup><Compile Include="../native-process/Other.fs" /></ItemGroup></Project>')
  const built = run(directory, ['scripts/build.mjs', 'process'])
  assert.notEqual(built.status, 0)
  assert.match(built.stderr, /Source must be local and explicit/)
})

function snapshot(directory) {
  const files = {}
  const walk = (folder, prefix) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(path.join(folder, entry.name), relative)
      else files[relative] = readFileSync(path.join(folder, entry.name), 'utf8')
    }
  }
  walk(directory, '')
  return files
}

test('SPEC[build-002] incremental build skips unchanged modules and rebuilds changed, tampered or forced ones', { timeout: 120000 }, t => {
  const directory = fixture(t, ['ordinal', 'bayes'])
  const build = (...args) => {
    const result = run(directory, ['scripts/build.mjs', ...args])
    succeed(result)
    return result.stdout
  }
  const status = (output, name) => output.match(new RegExp(`\\[build\\] ${name}: (cached|\\d+ ms)`))?.[1]
  let output = build()
  assert.match(status(output, 'ordinal'), /ms$/)
  assert.match(status(output, 'bayes'), /ms$/)
  const cold = snapshot(path.join(directory, 'dist'))

  output = build()
  assert.equal(status(output, 'ordinal'), 'cached')
  assert.equal(status(output, 'bayes'), 'cached')

  const source = path.join(directory, 'src/ordinal', readdirSync(path.join(directory, 'src/ordinal')).filter(file => file.endsWith('.fs'))[0])
  const original = readFileSync(source, 'utf8')
  writeFileSync(source, `${original}\n// incremental probe\n`)
  output = build()
  assert.match(status(output, 'ordinal'), /ms$/)
  assert.equal(status(output, 'bayes'), 'cached')
  writeFileSync(source, original)
  output = build()
  assert.match(status(output, 'ordinal'), /ms$/)

  const artifact = path.join(directory, 'dist/bayes', readdirSync(path.join(directory, 'dist/bayes')).find(file => file.endsWith('.js')))
  writeFileSync(artifact, `${readFileSync(artifact, 'utf8')}// tampered\n`)
  output = build()
  assert.equal(status(output, 'ordinal'), 'cached')
  assert.match(status(output, 'bayes'), /ms$/)
  const cached = snapshot(path.join(directory, 'dist'))

  output = build('--force')
  assert.match(status(output, 'ordinal'), /ms$/)
  assert.match(status(output, 'bayes'), /ms$/)
  const forced = snapshot(path.join(directory, 'dist'))
  assert.deepEqual(cached, forced)
  assert.deepEqual(cold, forced)
})
