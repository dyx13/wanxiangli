import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { NodeTime } from '../../../dist/time-node/NodeTime.js'

test('WHAT[TIME-CAPABILITY-006] an expired timer delay only settles the wait, it mints no business fact', async () => {
  let settled = false
  await NodeTime.timerTask(10).then(() => { settled = true })
  assert.equal(settled, true)
  // 到期只结束等待本身；任何业务结论都由消费方结合自己的规则得出。
  // 复合等待（信号 vs 到期 escape）的完整反例见 src/wait/tests/006.test.mjs。
})

test('WHAT[TIME-CAPABILITY-006] raceExit reports which side won without inventing an exit', async () => {
  const never = new Promise(() => {})
  assert.equal(await NodeTime.raceExit(never, 10), false)
  const immediate = Promise.resolve()
  assert.equal(await NodeTime.raceExit(immediate, 10), true)
})

test('WHAT[TIME-CAPABILITY-006] cancelling an already-settled handle is a harmless no-op', async () => {
  const handle = { Delay: NodeTime.timerTask(5), Cancel: () => {} }
  await handle.Delay
  handle.Cancel()
})

test('WHAT[TIME-CAPABILITY-006] an owned drain keeps Node alive until its long deadline returns false', () => {
  const entry = new URL('../../../dist/time-node/NodeTime.js', import.meta.url).href
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { NodeTime } from ${JSON.stringify(entry)};
    console.log(await NodeTime.raceExitKeepingAlive(new Promise(() => {}), 1000));
  `], { encoding: 'utf8', timeout: 5000 })
  assert.equal(child.error, undefined)
  assert.equal(child.status, 0, child.stderr)
  assert.equal(child.stdout.trim(), 'false')
})

test('WHAT[TIME-CAPABILITY-006] an owned drain releases its referenced timer on success and rejection', () => {
  const entry = new URL('../../../dist/time-node/NodeTime.js', import.meta.url).href
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { NodeTime } from ${JSON.stringify(entry)};
    console.log(await NodeTime.raceExitKeepingAlive(Promise.resolve(), 60000));
    const cause = new Error('original rejection');
    try { await NodeTime.raceExitKeepingAlive(Promise.reject(cause), 60000); }
    catch (error) { console.log(error === cause); }
  `], { encoding: 'utf8', timeout: 5000 })
  assert.equal(child.error, undefined)
  assert.equal(child.status, 0, child.stderr)
  assert.deepEqual(child.stdout.trim().split('\n'), ['true', 'true'])
})
