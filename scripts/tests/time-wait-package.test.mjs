import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { packedPackage } from './package-metadata.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const { NODE_PATH, NODE_OPTIONS, ...env } = process.env
const succeed = result => {
  assert.ifError(result.error)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  return result.stdout
}

test('SPEC[build-008] installed time and wait declarations match both runtimes and production survives virtual removal', { timeout: 90000 }, async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'wanxiangli-time-package-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const packed = packedPackage(succeed(spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], { cwd: root, env, encoding: 'utf8', timeout: 30000 })))
  const consumer = path.join(directory, 'consumer')
  mkdirSync(consumer)
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'time-wait-consumer', private: true, type: 'module' }))
  succeed(spawnSync('npm', ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', path.join(directory, packed.filename)], { cwd: consumer, env, encoding: 'utf8', timeout: 30000 }))
  for (const file of ['time-wait-consumer.ts', 'time-wait-consumer.mjs']) {
    copyFileSync(path.join(root, 'scripts/tests', file), path.join(consumer, file))
  }
  succeed(spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext', 'time-wait-consumer.ts'], { cwd: consumer, env, encoding: 'utf8', timeout: 30000 }))
  const runtimes = [['node', process.execPath]]
  if (spawnSync('bun', ['--version'], { env, encoding: 'utf8' }).status === 0) runtimes.push(['bun', 'bun'])
  for (const [name, executable] of runtimes) {
    await t.test(`actual installed time and wait consumer on ${name}`, () => {
      const result = spawnSync(executable, [path.join(consumer, 'time-wait-consumer.mjs')], { cwd: tmpdir(), env, encoding: 'utf8', timeout: 15000 })
      assert.match(succeed(result), /time\/wait package consumer passed/)
    })
  }
  const installed = path.join(consumer, 'node_modules/wanxiangli')
  rmSync(path.join(installed, 'dist/time-testing'), { recursive: true })
  writeFileSync(path.join(consumer, 'production.mjs'), `import { Time } from 'wanxiangli/time'
    import { NodeTime } from 'wanxiangli/time-node'
    if (Time.maxTimerWaitMs !== 2147483647 || !(NodeTime.nodeClockPort().UtcNow() instanceof Date)) throw Error('production')
  `)
  for (const [, executable] of runtimes) succeed(spawnSync(executable, [path.join(consumer, 'production.mjs')], { cwd: tmpdir(), env, encoding: 'utf8', timeout: 15000 }))
  rmSync(path.join(installed, 'dist/time-node'), { recursive: true })
  writeFileSync(path.join(consumer, 'pure.mjs'), `import { Time } from 'wanxiangli/time'
    if (Time.deadlineNextWaitMs('2026-10-19T00:00:00Z', Time.deadlineCreate('2026-10-19T00:00:00Z', 42)) !== 42) throw Error('pure')
  `)
  for (const [, executable] of runtimes) succeed(spawnSync(executable, [path.join(consumer, 'pure.mjs')], { cwd: tmpdir(), env, encoding: 'utf8', timeout: 15000 }))
  assert.equal(JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8')).version, JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version)
})
