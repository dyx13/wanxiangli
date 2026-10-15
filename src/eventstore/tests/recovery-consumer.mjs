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
connection.prepare = function (sql) {
  const statement = prepare.call(this, sql)
  statements.push(statement)
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
        assert.throws(() => statements.at(-1).get(), /finalized|closed/i)
      }
    } else {
      assert.equal(journal.append('stream', 0, 'first', 'body').status, 'Committed')
      assert.deepEqual(journal.read('stream'), ['body'])
    }
    journal.close()
  }
  for (const statement of statements) {
    assert.throws(() => statement.run(), /finalized|closed/i)
  }
  const restored = new SqliteJournal(new Database(filename))
  try {
    const bodies = mode === 'close' || mode === 'commit-after' ? ['body'] : []
    assert.deepEqual(restored.read('stream'), bodies)
    assert.equal(restored.append('stream', bodies.length, 'next', 'next body').status, 'Committed')
    assert.deepEqual(restored.read('stream'), [...bodies, 'next body'])
  } finally {
    restored.close()
  }
} finally {
  journal?.close()
  connection.exec = execute
  for (const statement of statements) statement.finalize?.()
  if (!journal && mode !== 'initialize') connection.close()
}
