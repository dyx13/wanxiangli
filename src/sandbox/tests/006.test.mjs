import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Sandbox } from './support.mjs'

const base = `class JsProgram {
  constructor(api) { this._api = api; }
  wait() { return this._api.wait(); }
  finish() { return this._api.finish(); }
}`
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const source = `class Js extends JsProgram {
  async run() { const value = await this.wait(); return { value, finished: await this.finish() }; }
}`

test('SPEC[sandbox-006] host pause holds settled work across the old deadline until reset and resume', async () => {
  const law = Sandbox()
  let resolve
  let finishes = 0
  const pending = new Promise((accept) => { resolve = accept })
  const handle = law.run({ wait: () => pending, finish: () => ++finishes }, 100, Date.now() + 80, base, source)
  let settled = false
  handle.programPromise.then(() => { settled = true }, () => { settled = true })
  handle.pause()
  resolve('resumed')
  await delay(180)
  assert.equal(settled, false)
  assert.equal(finishes, 0)
  law.resetDeadline(handle.deadlineRef, Date.now() + 1000)
  handle.resume()
  assert.deepEqual(JSON.parse(await handle.programPromise), { value: 'resumed', finished: 1 })
})

test('SPEC[sandbox-006] resume without a fresh deadline preserves the original deadline failure', async () => {
  const law = Sandbox()
  const handle = law.run({ wait: () => new Promise(() => {}) }, 100, Date.now() + 80, base, source)
  handle.pause()
  await delay(180)
  const rejected = assert.rejects(handle.programPromise, (error) => error?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT')
  handle.resume()
  await rejected
})

test('SPEC[sandbox-006] abandon after a paused deadline still runs finally within a fresh cleanup deadline', async () => {
  const law = Sandbox()
  let reject
  let finishes = 0
  const pending = new Promise((_, decline) => { reject = decline })
  const model = `class Js extends JsProgram {
    async run() { try { await this.wait(); } finally { await this.finish(); } }
  }`
  const handle = law.run({ wait: () => pending, finish: () => ++finishes }, 100, Date.now() + 80, base, model)
  handle.pause()
  await delay(180)
  reject(Object.assign(new Error('abandoned'), { __jsAbandoned: true }))
  law.resetDeadline(handle.deadlineRef, Date.now() + 1000)
  handle.resume()
  assert.deepEqual(JSON.parse(await handle.programPromise), { __jsAbandoned: true })
  assert.equal(finishes, 1)
})

test('SPEC[sandbox-006] resume keeps the vm timeout on a post-await infinite loop', () => {
  const dist = fileURLToPath(new URL('../../../dist/sandbox/Sandbox.js', import.meta.url))
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { Sandbox } from ${JSON.stringify(dist)};
    const law = Sandbox();
    let resolve;
    const pending = new Promise((accept) => { resolve = accept; });
    const handle = law.run({ wait: () => pending }, 100, Date.now() + 80,
      ${JSON.stringify(base)},
      'class Js extends JsProgram { async run() { await this.wait(); while (true) {} } }');
    handle.pause();
    setTimeout(() => {
      law.resetDeadline(handle.deadlineRef, Date.now() + 500);
      resolve();
      handle.resume();
    }, 180);
    const keepAlive = setInterval(() => {}, 1000);
    try { await handle.programPromise; process.exitCode = 2; }
    catch (error) { if (error.code !== 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw error; }
    finally { clearInterval(keepAlive); }
  `], { encoding: 'utf8', timeout: 5000 })
  assert.equal(child.status, 0, child.stderr)
})

test('SPEC[sandbox-006] a retained callback cannot call host capabilities while paused', async () => {
  const law = Sandbox()
  let callback
  let resolve
  let finishes = 0
  const pending = new Promise((accept) => { resolve = accept })
  const callbackBase = `${base}\nJsProgram.prototype.listen = function (fn) { return this._api.listen(fn); };`
  const model = `class Js extends JsProgram {
    async run() {
      this.listen(() => { try { this.finish(); return 'called'; } catch (error) { return error.message; } });
      return await this.wait();
    }
  }`
  const handle = law.run({
    listen: (fn) => { callback = fn },
    wait: () => pending,
    finish: () => ++finishes,
  }, 100, Date.now() + 1000, callbackBase, model)
  handle.pause()
  assert.equal(callback(), 'program is parked')
  assert.equal(finishes, 0)
  resolve('resumed')
  law.resetDeadline(handle.deadlineRef, Date.now() + 1000)
  handle.resume()
  assert.equal(JSON.parse(await handle.programPromise), 'resumed')
})

test('SPEC[sandbox-006] a paused host thenable settles once even when it calls both continuations repeatedly', async () => {
  const law = Sandbox()
  let settle
  let finishes = 0
  const pending = { then(resolve, reject) {
    settle = () => {
      resolve('first')
      resolve('second')
      reject(new Error('late rejection'))
    }
  } }
  const handle = law.run({ wait: () => pending, finish: () => ++finishes },
    100, Date.now() + 1000, base, source)
  handle.pause()
  settle()
  await delay(10)
  assert.equal(finishes, 0)
  handle.resume()
  assert.deepEqual(JSON.parse(await handle.programPromise), { value: 'first', finished: 1 })
  handle.resume()
  assert.equal(finishes, 1)
})

test('SPEC[sandbox-006] a late host settlement cannot revive a timed-out invocation', async () => {
  const law = Sandbox()
  let settle
  let finishes = 0
  const pending = new Promise(resolve => { settle = resolve })
  const handle = law.run({ wait: () => pending, finish: () => ++finishes },
    100, Date.now() + 80, base, source)
  const rejected = assert.rejects(handle.programPromise, error => error?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT')
  await delay(160)
  await rejected
  handle.pause()
  settle('late')
  law.resetDeadline(handle.deadlineRef, Date.now() + 1000)
  handle.resume()
  await delay(20)
  assert.equal(finishes, 0)
})
