import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
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

test('SPEC[build-009] every declared library and type is delivered unchanged without evidence archives or compiler dependencies', { timeout: 90000 }, async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'wanxiangli-exports-package-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const packed = packedPackage(succeed(spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], { cwd: root, env, encoding: 'utf8', timeout: 30000 })))
  const consumer = path.join(directory, 'consumer')
  mkdirSync(consumer)
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'all-exports-consumer', private: true, type: 'module' }))
  succeed(spawnSync('npm', ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', path.join(directory, packed.filename)], { cwd: consumer, env, encoding: 'utf8', timeout: 30000 }))
  const installed = path.join(consumer, 'node_modules/wanxiangli')
  const metadata = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'))
  const entries = ['durable-work', 'events', 'eventstore', 'fs', 'identity', 'ownership', 'process', 'resources', 'supervision', 'time', 'time-node', 'time-testing', 'trace', 'wait', 'work']
  assert.deepEqual(Object.keys(metadata.exports).sort(), entries.map(name => './' + name))
  const members = new Set(packed.files.map(file => file.path))
  for (const target of Object.values(metadata.exports)) {
    assert.equal(members.has(target.import.replace(/^\.\//, '')), true, target.import)
    assert.equal(members.has(target.types.replace(/^\.\//, '')), true, target.types)
  }
  for (const member of members) {
    assert.doesNotMatch(member, /^evidence\/|\.tgz$|\.fs(?:proj|i)?$|^scripts\//)
    assert.deepEqual(readFileSync(path.join(installed, member)), readFileSync(path.join(root, member)), member)
  }
  assert.equal(existsSync(path.join(consumer, 'node_modules/@fable-org')), false)
  assert.equal(existsSync(path.join(consumer, 'node_modules/typescript')), false)
  const script = path.join(consumer, 'imports.mjs')
  writeFileSync(script, `for (const name of ${JSON.stringify(entries)}) {
    const module = await import('wanxiangli/' + name)
    if (Object.keys(module).length === 0) throw Error('empty export: ' + name)
  }
  process.stdout.write('all 16 imports passed\\n')
  `)
  const runtimes = [['node', process.execPath]]
  if (spawnSync('bun', ['--version'], { env, encoding: 'utf8' }).status === 0) runtimes.push(['bun', 'bun'])
  for (const [name, executable] of runtimes) {
    await t.test(`all public imports outside the workspace on ${name}`, () => {
      assert.match(succeed(spawnSync(executable, [script], { cwd: tmpdir(), env, encoding: 'utf8', timeout: 15000 })), /all 16 imports passed/)
    })
  }
})
