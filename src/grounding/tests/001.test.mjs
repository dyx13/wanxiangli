import test from 'node:test'
import assert from 'node:assert/strict'
import { Grounding, workspace, write } from './support.mjs'

test('SPEC[grounding-001] discover finds requirements packages with WHAT.md, sorted by name', t => {
  const root = workspace(t)
  write(root, 'requirements/alpha/WHAT.md', '# alpha')
  write(root, 'requirements/beta/WHAT.md', '# beta')
  write(root, 'requirements/no-what/OTHER.md', '# not a package')
  const packages = Grounding.discover(root)
  assert.deepEqual(packages.map(p => p.name), ['alpha', 'beta'])
})

test('SPEC[grounding-001] discover returns empty when requirements/ is missing', t => {
  const root = workspace(t)
  assert.deepEqual(Grounding.discover(root), [])
})

test('SPEC[grounding-001] discover loads APPLIES-TO rules and skips comments and blank lines', t => {
  const root = workspace(t)
  write(root, 'requirements/alpha/WHAT.md', '# alpha')
  write(root, 'requirements/alpha/APPLIES-TO', [
    '# comment line',
    '',
    'src/docs/**',
    '!src/docs/ignored.md'
  ].join('\n'))
  const [alpha] = Grounding.discover(root)
  assert.deepEqual(alpha.rules, [
    { include: true, pattern: 'src/docs/**' },
    { include: false, pattern: 'src/docs/ignored.md' }
  ])
})

test('SPEC[grounding-001] APPLIES-TO declaring package self coverage is a configuration error', t => {
  const root = workspace(t)
  write(root, 'requirements/alpha/WHAT.md', '# alpha')
  write(root, 'requirements/alpha/APPLIES-TO', 'requirements/alpha/WHAT.md')
  assert.throws(() => Grounding.discover(root), /self coverage/)
})

test('SPEC[grounding-001] every possible self descendant is rejected before it exists', t => {
  const root = workspace(t)
  write(root, 'requirements/alpha/WHAT.md', '# alpha')
  const patterns = [
    '/requirements/alpha',
    '/requirements/alpha/tests/**',
    '/requirements/**/future?.fs',
    '/requirements/[a-c]lpha/tests/**',
    '/requirements/alpha/[]|a]',
    '/requirements/alpha/tests/雪.md',
    '/requirements/al**/a/**',
  ]
  for (const pattern of patterns) {
    for (const prefix of ['', '!']) {
      write(root, 'requirements/alpha/APPLIES-TO', prefix + pattern)
      assert.throws(() => Grounding.discover(root), /self coverage/, prefix + pattern)
    }
  }
  for (const pattern of ['/requirements/alpha-old/**', '/requirements/[b-z]lpha/**', '/src/**']) {
    write(root, 'requirements/alpha/APPLIES-TO', pattern)
    assert.deepEqual(Grounding.discover(root).map(entry => entry.name), ['alpha'])
  }
})
