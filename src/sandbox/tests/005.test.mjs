import test from 'node:test'
import assert from 'node:assert/strict'
import { Sandbox } from './support.mjs'

const base = `class JsProgram {
  constructor(api) { this._api = api; }
  call(Work) { return this._api.call(Work); }
}`

test('SPEC[sandbox-005] Callable commands preserve inherited properties and receiver without invoking toJSON', async () => {
  const law = Sandbox()
  let received
  const api = {
    async call(Work) {
      const work = new Work()
      const command = await work.next()
      received = { spawn: command.spawn, name: command.name }
      assert.deepEqual(received, { spawn: 'echo real-command', name: 'retained-command' })
      assert.equal(Object.getPrototypeOf(command), null, 'the bridge exposes no guest or host prototype')
      assert.equal(command.constructor, undefined)
      return received
    },
  }
  const source = `class Js extends JsProgram {
    async run() {
      let toJSONCalls = 0;
      class CommandBase {}
      CommandBase.prototype.name = 'retained-command';
      class Command extends CommandBase {
        constructor() { super(); this.prefix = 'echo'; }
        get spawn() { return this.prefix + ' real-command'; }
        toJSON() { toJSONCalls++; return { spawn: 'altered-command' }; }
      }
      class Work { next() { return new Command(); } }
      const observed = await this.call(Work);
      return { observed, toJSONCalls };
    }
  }`
  const handle = law.run(api, 1000, Date.now() + 5000, base, source)
  assert.deepEqual(JSON.parse(await handle.programPromise), {
    observed: { spawn: 'echo real-command', name: 'retained-command' },
    toJSONCalls: 0,
  })
  assert.deepEqual(received, { spawn: 'echo real-command', name: 'retained-command' })
})

test('SPEC[sandbox-005] class result methods keep host returns behind the membrane after prototype tampering', async () => {
  const law = Sandbox()
  const api = {
    async call(Work) {
      const command = await new Work().next()
      return command.observe({ value: 'wrapped' })
    },
  }
  const source = `class Js extends JsProgram {
    async run() {
      Object.getPrototypeOf = function () { throw new Error('poisoned'); };
      class Observation {
        observe(value) {
          let escaped = false;
          try { escaped = !!value.constructor.constructor('return process')(); } catch (_) {}
          return { value: value.value, escaped };
        }
      }
      class Work { next() { return new Observation(); } }
      return await this.call(Work);
    }
  }`
  const handle = law.run(api, 1000, Date.now() + 5000, base, source)
  assert.deepEqual(JSON.parse(await handle.programPromise), { value: 'wrapped', escaped: false })
})

test('SPEC[sandbox-005] plain command toJSON stays dormant at the host interpretation boundary', async () => {
  const law = Sandbox()
  const api = {
    async call(Work) {
      const command = await new Work().next()
      return { spawn: command.spawn, name: command.name }
    },
  }
  const source = `class Js extends JsProgram {
    async run() {
      let toJSONCalls = 0;
      class Work {
        next() {
          return { spawn: 'echo plain', name: 'plain', toJSON() { toJSONCalls++; return { spawn: 'altered' }; } };
        }
      }
      const observed = await this.call(Work);
      return { observed, toJSONCalls };
    }
  }`
  const handle = law.run(api, 1000, Date.now() + 5000, base, source)
  assert.deepEqual(JSON.parse(await handle.programPromise), {
    observed: { spawn: 'echo plain', name: 'plain' },
    toJSONCalls: 0,
  })
})
