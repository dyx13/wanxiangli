import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { packedPackage } from './package-metadata.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const { NODE_PATH, NODE_OPTIONS, ...cleanEnv } = process.env
const succeed = result => {
  assert.ifError(result.error)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  return result.stdout
}

test('SPEC[build-007] installed supervision retains output and a live group identity without sibling libraries or source', { timeout: 120000, skip: process.platform === 'win32' }, async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'wanxiangli-supervision-package-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const env = { ...cleanEnv, npm_config_cache: path.join(directory, 'npm-cache') }
  const packageSpec = process.env.WANXIANGLI_TEST_TARBALL ?? root
  const packed = packedPackage(succeed(spawnSync('npm', ['pack', packageSpec, '--ignore-scripts', '--json', '--pack-destination', directory], { cwd: directory, env, encoding: 'utf8', timeout: 30000 })))
  assert.ok(packed.files.some(file => file.path === 'dist/supervision/SupervisedProcess.js'))
  assert.ok(packed.files.some(file => file.path === 'src/supervision/index.d.ts'))
  assert.equal(packed.files.some(file => /\.(fs|fsi|fsproj)$/.test(file.path)), false)
  assert.equal(packed.files.some(file => file.path.startsWith('node_modules/')), false)
  const consumer = path.join(directory, 'consumer')
  mkdirSync(consumer)
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'supervision-only-consumer', private: true, type: 'module' }))
  succeed(spawnSync('npm', ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', path.join(directory, packed.filename)], { cwd: consumer, env, encoding: 'utf8', timeout: 30000 }))
  const installed = path.join(consumer, 'node_modules/wanxiangli')
  const metadata = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'))
  assert.deepEqual(metadata.dependencies ?? {}, {})
  assert.equal(existsSync(path.join(consumer, 'node_modules/@fable-org')), false)
  for (const module of ['lifecycle', 'eventstore', 'assembly', 'trace', 'session']) {
    rmSync(path.join(installed, 'dist', module), { recursive: true, force: true })
    rmSync(path.join(installed, 'src', module), { recursive: true, force: true })
  }
  for (const name of ['supervision-consumer.mjs', 'supervision-consumer.ts']) copyFileSync(path.join(root, 'scripts/tests', name), path.join(consumer, name))
  succeed(spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext', 'supervision-consumer.ts'], { cwd: consumer, env, encoding: 'utf8', timeout: 30000 }))
  rmSync(path.join(installed, 'src'), { recursive: true, force: true })
  const runtimes = [['node', process.execPath]]
  if (spawnSync('bun', ['--version'], { encoding: 'utf8', env }).status === 0) runtimes.push(['bun', 'bun'])
  else t.diagnostic('Bun is absent; its supervision consumer is not verified in this environment.')
  for (const [name, executable] of runtimes) {
    await t.test(`actual supervision consumer on ${name}`, () => {
      const output = succeed(spawnSync(executable, [path.join(consumer, 'supervision-consumer.mjs'), 'verify', name], { cwd: directory, env, encoding: 'utf8', timeout: 20000 }))
      assert.deepEqual(JSON.parse(output.trim()), { runtime: name, dualOutput: true, drainingGroupSignal: true })
    })
  }
  rmSync(path.join(installed, 'dist/supervision'), { recursive: true, force: true })
  for (const [name, executable] of runtimes) {
    await t.test(`base process survives supervision removal on ${name}`, () => {
      const output = succeed(spawnSync(executable, [path.join(consumer, 'supervision-consumer.mjs'), 'base', name], { cwd: directory, env, encoding: 'utf8', timeout: 10000 }))
      assert.deepEqual(JSON.parse(output.trim()), { runtime: name, baseProcess: true })
    })
  }
})
