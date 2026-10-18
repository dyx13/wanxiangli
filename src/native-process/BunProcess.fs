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

    [<Emit("""
      (() => {
        const child = new $3();
        let startPublished = false;
        let exit;
        let exitPublished = false;
        let closed = false;
        let outputClosed = 0;
        let pendingWrite;
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
        const nativeProcess = globalThis.Bun.spawn([$0, ...$1], {
          cwd: $2.cwd, env: $2.env, detached: $2.detached,
          stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
          onExit(_process, code, signal, error) {
            exit = { code: code ?? null, signal: signal ?? null, error };
            publishExit();
          },
        });
        child.pid = nativeProcess.pid;
        child.stdout = $4.fromWeb(nativeProcess.stdout);
        child.stderr = $4.fromWeb(nativeProcess.stderr);
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
        queueMicrotask(() => {
          startPublished = true;
          child.emit('spawn');
          publishExit();
        });
        return child;
      })()
    """)>]
    let private spawnNative (_file: string) (_arguments: string array) (_options: obj) (_events: obj) (_readable: obj) (_writable: obj): obj = jsNative

    let spawn file arguments options = spawnNative file arguments options eventEmitter readable writable
