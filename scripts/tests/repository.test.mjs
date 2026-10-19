import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import test from 'node:test'

test('SPEC[build-007] source dependencies exclude tarballs while fixed historical evidence keeps its bytes', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0')
  const retained = JSON.parse(readFileSync(path.join(root, 'evidence/retained-archives.json'), 'utf8'))
  assert.deepEqual(files.filter(file => /\.tgz$/i.test(file)).sort(), Object.keys(retained.archives).sort())
  for (const [file, digest] of Object.entries(retained.archives)) {
    assert.match(file, /^evidence\/process-stdin-0\.6\.(9|10|12)\/.+\.tgz$/)
    assert.equal(createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex'), digest, file)
  }
  const metadata = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  for (const group of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const value of Object.values(metadata[group] ?? {})) assert.doesNotMatch(value, /\.tgz(?:[?#].*)?$/i)
  }
  assert.equal(metadata.files.some(file => file.startsWith('evidence')), false)
})
