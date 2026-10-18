import * as original from 'node:fs'
import { tmpdir } from 'node:os'
import { mock } from 'bun:test'

const native = { ...original }
let failedDescriptor
const unhandled = []
process.on('uncaughtException', error => unhandled.push({ code: error.code, message: error.message }))
mock.module('node:fs', () => ({
  ...native,
  closeSync(descriptor) {
    if (failedDescriptor === undefined) {
      failedDescriptor = descriptor
      throw Object.assign(new Error('Controlled FIFO cleanup failure'), { code: 'EIO' })
    }
    return native.closeSync(descriptor)
  },
}))

const { ProcessSession } = await import('wanxiangli/process')
const session = new ProcessSession({ executable: '/wanxiangli-missing-cleanup-target', args: [], cwd: tmpdir(), env: {}, tailBytes: 0, maxWriteBytes: 1 }, 'Capture')
const started = await session.started()
const closed = await session.wait(100)
await new Promise(resolve => setImmediate(resolve))
let retained = false
try {
  native.fstatSync(failedDescriptor)
  retained = true
} finally {
  if (retained) native.closeSync(failedDescriptor)
}
console.log(JSON.stringify({ started, closed, unhandled, cleanupUnconfirmed: retained, probeCleaned: true }))
