import test from 'node:test'
import assert from 'node:assert/strict'
import { Delivery, fence, piece } from './support.mjs'

test('SPEC[delivery-006] capture freezes material pieces without publishing a delivery or advancing keys', () => {
  const delivery = Delivery()
  const candidates = [piece('original', 'original bytes')]
  const captured = delivery.capture('s', {}, candidates, 'pre-call prose')
  candidates[0].text = 'late mutation'
  candidates.push(piece('late'))
  assert.equal(delivery.peek('s'), null)
  assert.equal(delivery.peekCached('s'), null)
  assert.deepEqual(delivery.returned('s'), [])
  assert.equal(captured.pieces[0].text, 'original bytes')
  assert.throws(() => captured.pieces.push(piece('forged')), TypeError)
  assert.throws(() => { captured.pieces[0].text = 'forged' }, TypeError)
  assert.equal(delivery.publish('s', fence(), captured, 'sealed bytes'), true)
  assert.equal(delivery.peek('s'), 'sealed bytes')
  assert.deepEqual(delivery.returned('s'), [])
  const taken = delivery.claim('s', { mode: 'run', providerRun: 'run-1' })
  assert.deepEqual(delivery.handOff(taken, [piece('late')], 'late prose'), [])
  assert.deepEqual(delivery.returned('s'), captured.pieces.map(value => value.key))
  assert.throws(() => delivery.publish('s', fence(), captured, 'replacement'), /already spent/)
})

test('SPEC[delivery-006] an older capture cannot replace a delivery published during durable settlement', async () => {
  const delivery = Delivery()
  const captured = delivery.capture('s', {}, [piece('older')], null)
  const newer = fence('run-2', 'call-2')
  await Promise.resolve()
  delivery.deliver('s', newer, { current: true })
  delivery.seal('s', newer, 'newer bytes', ['newer'])
  assert.equal(delivery.publish('s', fence(), captured, 'older bytes'), false)
  assert.equal(delivery.peek('s'), 'newer bytes')
  assert.deepEqual(delivery.fence('s'), newer)
  delivery.clear('s')
  assert.throws(() => delivery.publish('s', fence(), captured, 'revived bytes'), /already spent/)
})

test('SPEC[delivery-006] captures are instance and session bound and clear revokes unpublished material', () => {
  const delivery = Delivery()
  const other = Delivery()
  const captured = delivery.capture('s', {}, [piece('original')], null)
  assert.throws(() => other.publish('s', fence(), captured, 'bytes'), /not issued/)
  assert.throws(() => delivery.publish('wrong', fence(), captured, 'bytes'), /session/)
  assert.throws(() => delivery.publish('s', fence(), { pieces: captured.pieces }, 'bytes'), /not issued/)
  delivery.clear('s')
  assert.equal(delivery.publish('s', fence(), captured, 'bytes'), false)
  assert.equal(delivery.peek('s'), null)
  const pending = delivery.capture('s', {}, [piece('pending')], null)
  delivery.clearAll()
  assert.equal(delivery.publish('s', fence(), pending, 'bytes'), false)
})

test('SPEC[delivery-006] capture uses the existing returned cursor and preserves unrelated sessions', () => {
  const delivery = Delivery()
  delivery.restore('s', fence(), 'previous bytes')
  delivery.deliver('other', fence(), {})
  const previous = delivery.claim('other', { mode: 'run', providerRun: 'run-1' })
  delivery.handOff(previous, [piece('seen')], null)
  const captured = delivery.capture('other', {}, [piece('seen'), piece('fresh')], null)
  assert.deepEqual(captured.pieces.map(value => value.key), ['fresh'])
  delivery.clear('s')
  assert.equal(delivery.publish('other', fence(), captured, 'fresh bytes'), true)
  assert.deepEqual(delivery.returned('other'), ['seen'])
})
