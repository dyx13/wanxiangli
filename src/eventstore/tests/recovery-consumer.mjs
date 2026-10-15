import assert from 'node:assert/strict'
import { SqliteJournal } from 'wanxiangli/eventstore'

const [runtime, mode, filename] = process.argv.slice(2)
const Database = runtime === 'bun'
  ? (await import('bun:sqlite')).Database
  : (await import('node:sqlite')).DatabaseSync
const connection = new Database(filename)
const statements = []
const prepare = connection.prepare
const execute = connection.exec
const close = connection.close
let closeAttempts = 0
if (mode.endsWith('close-retry')) {
  connection.close = function () {
    closeAttempts += 1
    if (closeAttempts === 1) throw new Error('Injected connection close failure')
    return close.call(this)
  }
}
connection.prepare = function (sql) {
  const statement = prepare.call(this, sql)
  statements.push({ statement, get: statement.get })
  if ((mode === 'initialize' && sql === 'PRAGMA quick_check') || (mode === 'read' && sql.startsWith('SELECT revision'))) {
    const method = mode === 'initialize' ? 'get' : 'all'
    const original = statement[method]
    statement[method] = function (...parameters) {
      original.apply(this, parameters)
      throw new Error('Injected statement failure')
    }
  }
  return statement
}
let journal
try {
  if (mode === 'initialize') {
    assert.throws(() => new SqliteJournal(connection), /Injected statement failure/)
  } else {
    journal = new SqliteJournal(connection)
    if (mode.startsWith('commit-')) {
      connection.exec = function (sql) {
        if (sql !== 'COMMIT') return execute.call(this, sql)
        if (mode === 'commit-after') execute.call(this, sql)
        throw new Error('Commit acknowledgement was lost')
      }
      assert.equal(journal.append('stream', 0, 'first', 'body').status, 'Unknown')
      assert.throws(() => journal.read('stream'), /closed/)
      assert.throws(() => journal.append('stream', 0, 'second', 'body'), /closed/)
    } else if (mode === 'read') {
      assert.throws(() => journal.read('stream'), /Injected statement failure/)
      if (runtime === 'bun') {
        const retained = statements.at(-1)
        assert.throws(() => retained.get.call(retained.statement), /finaliz/i)
      }
    } else {
      assert.equal(journal.append('stream', 0, 'first', 'body').status, 'Committed')
      assert.deepEqual(journal.read('stream'), ['body'])
    }
    if (mode === 'close-retry') {
      assert.throws(() => journal.close(), /Injected connection close failure/)
      assert.throws(() => journal.read('stream'), /closed/)
      assert.throws(() => journal.append('stream', 1, 'second', 'body'), /closed/)
    }
    journal.close()
    if (mode.endsWith('close-retry')) {
      assert.equal(closeAttempts, 2, 'the explicit close must retry physical release after the first failure')
      journal.close()
      assert.equal(closeAttempts, 2, 'a confirmed close remains idempotent')
    }
  }
  for (const { statement, get } of statements) {
    assert.throws(() => get.call(statement), /finaliz/i)
  }
  const restored = new SqliteJournal(new Database(filename))
  try {
    const bodies = ['close', 'close-retry', 'commit-after'].includes(mode) ? ['body'] : []
    assert.deepEqual(restored.read('stream'), bodies)
    assert.equal(restored.append('stream', bodies.length, 'next', 'next body').status, 'Committed')
    assert.deepEqual(restored.read('stream'), [...bodies, 'next body'])
  } finally {
    restored.close()
  }
} finally {
  journal?.close()
  connection.exec = execute
  for (const { statement } of statements) statement.finalize?.()
  try { close.call(connection) } catch {}
}
