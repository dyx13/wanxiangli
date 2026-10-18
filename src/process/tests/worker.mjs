import { writeSync, writeFileSync, readSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const [mode, ...args] = process.argv.slice(2)
switch (mode) {
  case 'report':
    process.stdout.write(JSON.stringify({ args, cwd: process.cwd(), env: process.env }))
    process.stderr.write('diagnostic\n')
    break
  case 'stamp':
    writeFileSync(args[0], 'executed')
    break
  case 'exit':
    process.exitCode = Number(args[0])
    break
  case 'echo':
    process.stdin.pipe(process.stdout)
    process.stderr.write('ready\n')
    break
  case 'input-digest': {
    await delay(200)
    const hash = createHash('sha256')
    let size = 0
    for await (const bytes of process.stdin) {
      size += bytes.length
      hash.update(bytes)
    }
    process.stdout.write(JSON.stringify({ size, hash: hash.digest('hex') }))
    break
  }
  case 'idle':
    process.on('SIGTERM', () => process.stderr.write('term-seen\n'))
    process.stdin.resume()
    process.stdin.on('end', () => process.exit(0))
    process.stdout.write('ready\n')
    break
  case 'paused':
    setInterval(() => {}, 1000)
    process.stdout.write('ready\n')
    break
  case 'partial-input': {
    process.stdout.write('ready\n')
    const first = Buffer.alloc(1)
    if (readSync(0, first, 0, 1, null) !== 1) throw new Error('Expected one actual input byte')
    process.stdout.write(`accepted:${first[0]}\n`)
    setInterval(() => {}, 1000)
    break
  }
  case 'bytes':
    process.stdout.write(Buffer.from(args[0], 'base64'))
    process.stderr.write(Buffer.from(args[1] ?? '', 'base64'))
    break
  case 'flood': {
    const block = Buffer.alloc(65536, 0x61)
    for (let i = 0; i < 128; i++) writeSync(1, block)
    for (let i = 0; i < 16; i++) writeSync(2, block)
    writeSync(1, Buffer.from('最后的原始输出🧭\n'))
    writeSync(2, Buffer.from('stderr-tail\n'))
    break
  }
  case 'relay-flood': {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'duplex-flood'], { stdio: ['pipe', 'pipe', 'pipe'], env: {} })
    child.stdout.pipe(process.stdout, { end: false })
    child.stderr.pipe(process.stderr, { end: false })
    process.stdin.pipe(child.stdin)
    child.stdin.on('error', () => {})
    child.on('close', () => {
      process.stdout.write(new Uint8Array(0), () => {
        process.stderr.write(new Uint8Array(0), () => writeFileSync(args[0], 'flushed'))
      })
    })
    setInterval(() => {}, 60000)
    break
  }
  case 'duplex-flood': {
    const size = 8 * 1024 * 1024 + 17
    const write = async (stream, byte) => {
      const block = Buffer.alloc(65521, byte)
      for (let offset = 0; offset < size; offset += block.length) {
        if (!stream.write(block.subarray(0, Math.min(block.length, size - offset)))) await once(stream, 'drain')
      }
      await new Promise(resolve => stream.write(Buffer.from([0, 255, 13, 10, byte]), resolve))
    }
    await Promise.all([write(process.stdout, 65), write(process.stderr, 66)])
    break
  }
  case 'split': {
    let phase = 0
    process.stdin.on('data', () => {
      const chunks = [Buffer.from([0xf0, 0x9f]), Buffer.from([0x98, 0x80]), Buffer.from('尾')]
      process.stdout.write(chunks[phase++])
    })
    break
  }
  case 'grandchild':
    process.on('SIGTERM', () => process.stdout.write('grandchild-term\n'))
    process.stdout.write(JSON.stringify({ grandchild: process.pid }) + '\n')
    setInterval(() => {}, 1000)
    break
  case 'group': {
    process.on('SIGTERM', () => process.stderr.write('leader-term\n'))
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'grandchild'], { stdio: ['ignore', 'pipe', 'pipe'], env: {} })
    child.stdout.pipe(process.stdout)
    child.stderr.pipe(process.stderr)
    break
  }
  case 'draining': {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'grandchild'], { stdio: ['ignore', 1, 2], env: {} })
    child.unref()
    process.exit(0)
    break
  }
  default: throw new Error(`Unknown worker mode: ${mode}`)
}
