namespace Wanxiangli.NativeProcess

open Fable.Core
open Fable.Core.JsInterop

module internal BunProcess =
    [<Import("EventEmitter", "node:events")>]
    let private eventEmitter: obj = jsNative

    [<Import("Readable", "node:stream")>]
    let private readable: obj = jsNative

    [<Import("Writable", "node:stream")>]
    let private writable: obj = jsNative

    [<ImportAll("node:fs")>]
    let private files: obj = jsNative

    [<Import("tmpdir", "node:os")>]
    let private temporaryDirectory (): string = jsNative

    [<Import("join", "node:path")>]
    let private join (_left: string) (_right: string): string = jsNative

    [<Emit("""
      (() => {
        const files = $0;
        const directory = files.mkdtempSync($2);
        const paths = [directory + '/stdout', directory + '/stderr'];
        const descriptors = new Set();
        const outputs = [];
        const reader = descriptor => {
          let pending = null;
          let immediate = false;
          let idleDelay = 0;
          let buffer;
          const receive = () => {
            if (stream.destroyed) return;
            buffer ??= Buffer.allocUnsafe(65536);
            let count;
            try {
              count = files.readSync(descriptor, buffer, 0, buffer.length, null);
            } catch (error) {
              if (error.code === 'EAGAIN' || error.code === 'EWOULDBLOCK') {
                const retry = () => {
                  pending = null;
                  receive();
                };
                immediate = idleDelay === 0;
                pending = immediate ? setImmediate(retry) : setTimeout(retry, idleDelay);
                idleDelay = idleDelay === 0 ? 1 : Math.min(5, idleDelay * 2);
              } else {
                stream.destroy(error);
              }
              return;
            }
            idleDelay = 0;
            if (count === 0) stream.push(null);
            else stream.push(Buffer.from(buffer.subarray(0, count)));
          };
          const stream = new $1({
            highWaterMark: 65536,
            read() { if (pending === null) receive(); },
            destroy(error, callback) {
              if (immediate) clearImmediate(pending);
              else clearTimeout(pending);
              pending = null;
              buffer = undefined;
              const owned = descriptor;
              descriptor = -1;
              try {
                files.closeSync(owned);
                callback(error);
              }
              catch (closeError) { callback(error ?? closeError); }
            },
          });
          return stream;
        };
        try {
          const created = globalThis.Bun.spawnSync(['/usr/bin/mkfifo', ...paths], {
            cwd: directory, env: {}, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe',
          });
          if (created.exitCode !== 0) throw Object.assign(new Error(new TextDecoder().decode(created.stderr) || 'Could not create output pipes'), { code: 'PIPE_SETUP_FAILED' });
          const pipes = paths.map(path => {
            const read = files.openSync(path, files.constants.O_RDONLY | files.constants.O_NONBLOCK);
            descriptors.add(read);
            const write = files.openSync(path, files.constants.O_WRONLY);
            descriptors.add(write);
            return { read, write };
          });
          for (const path of paths) files.unlinkSync(path);
          files.rmdirSync(directory);
          for (const pipe of pipes) {
            outputs.push({ readable: reader(pipe.read), writer: pipe.write });
            descriptors.delete(pipe.read);
          }
          return outputs;
        } catch (error) {
          let cleanupFailure;
          for (const output of outputs) {
            output.readable.on('error', () => {});
            output.readable.destroy();
            cleanupFailure ??= output.readable.errored;
          }
          for (const descriptor of descriptors) {
            try { files.closeSync(descriptor); }
            catch (closeError) { cleanupFailure ??= closeError; }
          }
          try { files.rmSync(directory, { recursive: true, force: true }); }
          catch (removeError) { cleanupFailure ??= removeError; }
          if (cleanupFailure) throw Object.assign(new Error(error.message + '; output cleanup was not confirmed: ' + cleanupFailure.message), { code: cleanupFailure.code || 'PIPE_CLEANUP_FAILED' });
          throw error;
        }
      })()
    """)>]
    let private outputPipes (_files: obj) (_readable: obj) (_prefix: string): obj = jsNative

    [<Emit("""
      (() => {
        const child = new $3();
        let startPublished = false;
        let exit;
        let exitPublished = false;
        let closed = false;
        let outputClosed = 0;
        let pendingWrite;
        let nativeProcess;
        const tryClose = () => {
          if (exitPublished && outputClosed === 2 && !closed) {
            closed = true;
            child.emit('close', exit.code, exit.signal);
          }
        };
        const publishExit = () => {
          if (!startPublished || !exit || exitPublished) return;
          exitPublished = true;
          if (pendingWrite) pendingWrite(Object.assign(new Error('Process exited before the input write was acknowledged'), { code: 'ERR_STREAM_DESTROYED' }));
          child.stdin.destroy();
          if (exit.error) child.emit('error', exit.error);
          child.emit('exit', exit.code, exit.signal);
          tryClose();
        };
        child.stdout = $4[0].readable;
        child.stderr = $4[1].readable;
        for (const output of [child.stdout, child.stderr]) output.once('close', () => {
          outputClosed++;
          tryClose();
        });
        child.stdin = new $5({
          write(bytes, _encoding, callback) {
            let completed = false;
            const complete = error => {
              if (completed) return;
              completed = true;
              pendingWrite = undefined;
              callback(error);
            };
            pendingWrite = complete;
            Promise.resolve().then(() => nativeProcess.stdin.write(bytes)).then(async count => {
              if (count !== bytes.length) throw Object.assign(new Error(`Only ${count} of ${bytes.length} input bytes were acknowledged`), { code: 'ERR_STREAM_DESTROYED' });
              await nativeProcess.stdin.flush();
              complete();
            }).catch(complete);
          },
          final(callback) {
            Promise.resolve().then(() => nativeProcess.stdin.end()).then(() => callback(), callback);
          },
        });
        try {
          nativeProcess = globalThis.Bun.spawn([$0, ...$1], {
            cwd: $2.cwd, env: $2.env, detached: $2.detached,
            stdin: 'pipe', stdout: $4[0].writer, stderr: $4[1].writer,
            onExit(_process, code, signal, error) {
              exit = { code: code ?? null, signal: signal ?? null, error };
              publishExit();
            },
          });
        } catch (error) {
          child.stdin.destroy();
          let cleanupFailure;
          for (const output of $4) {
            output.readable.on('error', () => {});
            output.readable.destroy();
            cleanupFailure ??= output.readable.errored;
            try { $6.closeSync(output.writer); }
            catch (closeError) { cleanupFailure ??= closeError; }
          }
          if (cleanupFailure) throw Object.assign(new Error(error.message + '; output cleanup was not confirmed: ' + cleanupFailure.message), { code: cleanupFailure.code || 'PIPE_CLEANUP_FAILED' });
          throw error;
        }
        child.pid = nativeProcess.pid;
        let closeFailure;
        for (const output of $4) {
          try { $6.closeSync(output.writer); }
          catch (error) { closeFailure ??= error; }
        }
        queueMicrotask(() => {
          startPublished = true;
          child.emit('spawn');
          if (closeFailure) {
            child.emit('error', closeFailure);
            child.stdout.destroy(closeFailure);
            child.stderr.destroy(closeFailure);
          }
          publishExit();
        });
        return child;
      })()
    """)>]
    let private spawnNative (_file: string) (_arguments: string array) (_options: obj) (_events: obj) (_outputs: obj) (_writable: obj) (_files: obj): obj = jsNative

    [<Emit("""
      (() => {
        const sink = globalThis.Bun.file($0).writer({ highWaterMark: 65536 });
        return new $1({
          highWaterMark: 65536,
          write(bytes, _encoding, callback) {
            Promise.resolve().then(() => sink.write(bytes)).then(async count => {
              if (count !== bytes.length) throw Object.assign(new Error('Incomplete output forwarding write'), { code: 'ERR_STREAM_DESTROYED' });
              await sink.flush();
              callback();
            }).catch(callback);
          },
        });
      })()
    """)>]
    let private outputNative (_descriptor: int) (_writable: obj): obj = jsNative

    let output descriptor = outputNative descriptor writable

    let spawn file arguments options =
        let outputs = outputPipes files readable (join (temporaryDirectory ()) "wanxiangli-pipes-")
        spawnNative file arguments options eventEmitter outputs writable files
