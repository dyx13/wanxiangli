import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const mode = process.argv[2]
if (mode === 'echo') {
  process.stdin.pipe(process.stdout)
} else if (mode === 'input-digest') {
  await delay(200)
  const hash = createHash('sha256')
  let size = 0
  for await (const bytes of process.stdin) {
    size += bytes.length
    hash.update(bytes)
  }
  process.stdout.write(JSON.stringify({ size, hash: hash.digest('hex') }))
} else if (mode === 'facts') {
  process.stdout.write(JSON.stringify({ args: process.argv.slice(3), cwd: process.cwd(), env: process.env }))
} else if (mode === 'flood') {
  const size = Number(process.argv[3])
  async function write(stream, byte) {
    const chunk = Buffer.alloc(65521, byte)
    for (let offset = 0; offset < size; offset += chunk.length) {
      if (!stream.write(chunk.subarray(0, Math.min(chunk.length, size - offset)))) await once(stream, 'drain')
    }
    await new Promise(resolve => stream.write(Buffer.from([0, 255, 13, 10, byte]), resolve))
  }
  await Promise.all([write(process.stdout, 65), write(process.stderr, 66)])
} else if (mode === 'held' || mode === 'closed-descendant') {
  const child = spawn(process.execPath, [process.argv[1], mode === 'held' ? 'descendant' : 'closed-child'], {
    detached: false,
    stdio: ['ignore', mode === 'held' ? 'inherit' : 'ignore', mode === 'held' ? 'inherit' : 'ignore', 'ipc'],
    env: {},
  })
  await once(child, 'message')
  await new Promise(resolve => process.stdout.write(JSON.stringify({ descendant: child.pid }) + '\n', resolve))
  process.exit(mode === 'held' ? 23 : 0)
} else if (mode === 'descendant' || mode === 'closed-child') {
  process.on('SIGTERM', () => { if (mode === 'descendant') process.stderr.write('descendant-term\n') })
  process.send('ready')
  setInterval(() => {}, 60000)
} else if (mode === 'idle') {
  process.stdout.write('ready\n')
  setInterval(() => {}, 60000)
} else {
  throw new Error(`Unknown fixture mode: ${mode}`)
}
