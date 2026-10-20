import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const { NODE_PATH, NODE_OPTIONS, ...env } = process.env
const succeed = result => {
  assert.ifError(result.error)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  return result.stdout
}

test('WHAT[durable-convergence-011] actual retention tarball works without source, compiler or sibling modules', { timeout: 60000 }, async t => {
  const directory = fs.mkdtempSync(join(tmpdir(), 'wanxiangli-retention-package-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const packageEnv = { ...env, npm_config_cache: join(directory, 'npm-cache') }
  delete packageEnv.npm_config_allow_scripts
  const packedJson = JSON.parse(succeed(spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory],
    { cwd: root, env: packageEnv, encoding: 'utf8', timeout: 30000 })))
  const packed = Array.isArray(packedJson) ? packedJson[0] : packedJson.wanxiangli
  assert.equal(packed.version, '0.9.2')
  assert.ok(packed.files.some(file => file.path === 'src/retention/index.d.ts'))
  assert.ok(packed.files.some(file => file.path === 'dist/retention/WriterRetention.js'))
  for (const file of packed.files) assert.doesNotMatch(file.path, /\.fs(?:proj|i)?$|^scripts\/|^node_modules\//)
  const consumer = join(directory, 'consumer')
  fs.mkdirSync(consumer)
  fs.writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'retention-only-consumer', private: true, type: 'module' }))
  succeed(spawnSync('npm', ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', join(directory, packed.filename)],
    { cwd: consumer, env: packageEnv, encoding: 'utf8', timeout: 30000 }))
  const installed = join(consumer, 'node_modules', 'wanxiangli')
  assert.equal(fs.lstatSync(installed).isSymbolicLink(), false)
  assert.equal(fs.existsSync(join(consumer, 'node_modules/@fable-org')), false)
  assert.equal(fs.existsSync(join(consumer, 'node_modules/typescript')), false)
  for (const folder of ['src', 'dist']) {
    for (const name of fs.readdirSync(join(installed, folder))) {
      if (name !== 'retention') fs.rmSync(join(installed, folder, name), { recursive: true, force: true })
    }
  }
  fs.writeFileSync(join(consumer, 'consumer.ts'), `
import { WriterRetention, type TailClassification } from 'wanxiangli/retention'
const retention = new WriterRetention()
const now = Date.UTC(2026, 9, 20)
const source = [{ writerId: 'one', lastActivityMs: now }] as const
const identity: string = retention.retain(now, source)[0].writerId
const classification: TailClassification = retention.classifyTail('null')
const activity: number | null = retention.lastActivity(['null'])
// @ts-expect-error non-numeric cutoff
retention.isRetained('today', now)
// @ts-expect-error missing writer activity
retention.retain(now, [{ writerId: 'missing' }])
void identity; void classification; void activity
`)
  succeed(spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict',
    '--target', 'es2022', '--module', 'nodenext', 'consumer.ts'],
  { cwd: consumer, env, encoding: 'utf8', timeout: 30000 }))
  const script = join(consumer, 'consumer.mjs')
  fs.writeFileSync(script, `
import assert from 'node:assert/strict'
import { WriterRetention } from 'wanxiangli/retention'
const retention = new WriterRetention()
const now = Date.UTC(2026, 9, 20, 12)
const source = { writerId: 'one', lastActivityMs: now }
assert.equal(retention.retain(now, [source])[0], source)
assert.equal(retention.isRetained(now, Date.UTC(2026, 9, 19)), true)
assert.equal(retention.isRetained(now, Date.UTC(2026, 9, 18, 23, 59, 59, 999)), false)
for (const invalid of [NaN, Infinity, -Infinity]) assert.throws(() => retention.isRetained(invalid, now), /finite/)
assert.deepEqual(retention.classifyTail(JSON.stringify({ event_type: 'JournalEnvelope', payload: { ObservedAt: 0 } })), { kind: 'silent' })
let pulls = 0
function* lines() {
  pulls++
  yield JSON.stringify({ event_type: 'ProjectionCutTail' })
  pulls++
  yield JSON.stringify({ event_type: 'JournalEnvelope', payload: { ObservedAt: '2026-10-20T00:00:00Z' } })
  throw Error('read beyond the first activity verdict')
}
assert.equal(retention.lastActivity(lines()), Date.UTC(2026, 9, 20))
assert.equal(pulls, 2)
console.log('retention-only consumer passed')
`)
  assert.equal(spawnSync('bun', ['--version'], { env, encoding: 'utf8' }).status, 0, 'Bun is required for this package proof')
  for (const [name, executable] of [['node', process.execPath], ['bun', 'bun']]) {
    await t.test(`retention-only installed consumer on ${name}`, () => {
      assert.match(succeed(spawnSync(executable, [script], { cwd: tmpdir(), env, encoding: 'utf8', timeout: 15000 })),
        /retention-only consumer passed/)
    })
  }
  t.diagnostic(JSON.stringify({ version: packed.version, filename: packed.filename, integrity: packed.integrity,
    independent: true, sourceAbsent: true, compilerAbsent: true, typescript: true, runtimes: ['node', 'bun'] }))
})
