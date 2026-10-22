import test from 'node:test'
import assert from 'node:assert/strict'
import { Sandbox } from './support.mjs'

// SPEC[sandbox-003]: the membrane shares its realm with the model program, so a
// model that monkeypatches a built-in method the membrane relies on must not be
// able to observe the raw host values the membrane feeds those methods. The
// confirmed route was WeakMap.prototype.has/.set: wrap()/unwrap() pass the real
// host object to the map, so a patched method receives it and can reach the host
// process through constructor.constructor. The membrane must call these methods
// through references captured before any model code runs.
// Base-red: these cases report leaked=true on the 0.23.1 membrane (library
// d2a9f3b); see host evidence/CUT-25/membrane-0.23.1-red-intrinsics.json.

const law = Sandbox()
const BASE = `class JsProgram {
  constructor(api) { this._api = api; }
  async ls(path) { return await this._api.ls(path); }
  async cat(path) { return await this._api.cat(path); }
}`
const api = { ls: async () => ['a.txt', 'sub/'], cat: async () => 'hello' }

async function runMembrane(body, deadlineMs = 2000, suppliedApi = api) {
  const src = `class Js extends JsProgram { async run() { ${body} } }`
  const handle = law.run(suppliedApi, deadlineMs, Date.now() + 60_000, BASE, src)
  try {
    const json = await handle.programPromise
    if (typeof json === 'string' && json.includes('__jsProgramFailed')) return { ok: false, json: JSON.parse(json) }
    return { ok: true, value: JSON.parse(json) }
  } catch (e) { return { ok: false, err: String(e && e.message || e) } }
}

const PROC = `const isProc = (p) => !!(p && typeof p.pid === 'number' && typeof p.getBuiltinModule === 'function');`
const patchHas = `${PROC}
  let leaked = false;
  const original = WeakMap.prototype.has;
  WeakMap.prototype.has = function (key) {
    try { const p = key && key.constructor && key.constructor.constructor('return process')(); if (isProc(p)) leaked = true; } catch (_) {}
    return original.call(this, key);
  };
  try { await this.ls('.'); } finally { WeakMap.prototype.has = original; }
  return { leaked };`
const patchSet = `${PROC}
  let leaked = false;
  const original = WeakMap.prototype.set;
  WeakMap.prototype.set = function (key, value) {
    try { const p = key && key.constructor && key.constructor.constructor('return process')(); if (isProc(p)) leaked = true; } catch (_) {}
    return original.call(this, key, value);
  };
  try { await this.ls('.'); } finally { WeakMap.prototype.set = original; }
  return { leaked };`

test('SPEC[sandbox-003] membrane: patched WeakMap.prototype.has cannot observe a host value', async () => {
  const r = await runMembrane(patchHas)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.value.leaked, false)
})

test('SPEC[sandbox-003] membrane: patched WeakMap.prototype.set cannot observe a host value', async () => {
  const r = await runMembrane(patchSet)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.value.leaked, false)
})

test('SPEC[sandbox-003] membrane still returns normal ls data after intrinsic churn', async () => {
  const r = await runMembrane(`const o = WeakMap.prototype.has; WeakMap.prototype.has = o; return { entries: await this.ls('.') };`)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.deepEqual(r.value.entries, ['a.txt', 'sub/'])
})

test('SPEC[sandbox-003] host budget refusal retains its safe minimum without exposing the host failure object', async () => {
  const error = new Error('output budget is too small')
  error.__jsFailure = {
    code: 'CALL_OUTPUT_BUDGET_TOO_SMALL',
    reason: error.message,
    minimumOutputBudgetBytes: 1024,
    hostObject: { secret: true },
  }
  const result = await runMembrane(`
    Number.isSafeInteger = () => { throw new Error('patched intrinsic was called'); };
    try { await this.cat('.'); } catch (error) {
      const failure = error.__jsFailure;
      let escaped = false;
      try { escaped = !!failure.constructor.constructor('return process')(); } catch (_) {}
      return { failure, keys: Object.keys(failure).sort(), escaped };
    }
  `, 2000, { cat: async () => { throw error } })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.deepEqual(result.value, {
    failure: { code: 'CALL_OUTPUT_BUDGET_TOO_SMALL', reason: error.message, minimumOutputBudgetBytes: 1024 },
    keys: ['code', 'minimumOutputBudgetBytes', 'reason'],
    escaped: false,
  })
})

test('SPEC[sandbox-003] host budget minimum rejects nonpositive, inexact and nonnumeric values without coercion', async () => {
  let coercions = 0
  for (const minimum of [undefined, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1024', 1024n,
    { valueOf() { coercions += 1; return 1024 } }]) {
    const error = new Error('output budget is too small')
    error.__jsFailure = { code: 'CALL_OUTPUT_BUDGET_TOO_SMALL', reason: error.message, minimumOutputBudgetBytes: minimum }
    const result = await runMembrane(`
      try { await this.cat('.'); } catch (error) {
        return { keys: Object.keys(error.__jsFailure).sort() };
      }
    `, 2000, { cat: async () => { throw error } })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.deepEqual(result.value.keys, ['code', 'reason'])
  }
  assert.equal(coercions, 0)
})

test('SPEC[sandbox-003] an uncaught host budget refusal keeps its minimum in the host failure sentinel', async () => {
  for (const minimum of [1024, 0, '1024', { valueOf() { throw new Error('must not coerce') } }]) {
    const error = new Error('output budget is too small')
    error.__jsFailure = { code: 'CALL_OUTPUT_BUDGET_TOO_SMALL', reason: error.message, minimumOutputBudgetBytes: minimum }
    const result = await runMembrane(`return await this.cat('.');`, 2000, { cat: async () => { throw error } })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.deepEqual(result.value, {
      __jsHostFailed: true,
      code: 'CALL_OUTPUT_BUDGET_TOO_SMALL',
      reason: error.message,
      ...(minimum === 1024 ? { minimumOutputBudgetBytes: 1024 } : {}),
    })
  }
})
