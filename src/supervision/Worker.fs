namespace Wanxiangli.Supervision

open Fable.Core.JsInterop

module internal Worker =
    let run directory =
        let mutable failed = false
        let mutable targetClosed = false
        let mutable stdoutFlushed = false
        let mutable stderrFlushed = false
        let mutable publishedClose = false

        let publish name value =
            try Native.publish directory name value
            with _ -> Native.killOwnGroup Native.runtime

        let fault operation error =
            if not failed then
                failed <- true
                publish "fault" (Native.failure operation error)

        let finish () =
            if not publishedClose && not failed && targetClosed && stdoutFlushed && stderrFlushed then
                publishedClose <- true
                publish "closed" (Native.objectOf [ "closed", box true ])

        for signal in [ "SIGTERM"; "SIGINT"; "SIGHUP" ] do
            Native.on1 Native.runtime signal ignore
        // 组长只由外侧在读取关闭证据后清组；目标退出不能提前释放 PGID。
        Native.interval ignore 60000 |> ignore
        try
            let options = Native.read (Native.join directory "request") |> Options.read
            let target = Native.spawn (unbox (Native.get options "executable")) (unbox (Native.get options "args"))
                            (Native.objectOf [ "cwd", Native.get options "cwd"; "env", Native.get options "env"
                                               "shell", box false; "detached", box false
                                               "stdio", box [| "pipe"; "pipe"; "pipe" |] ])
            let mutable started = false
            Native.on1 target "spawn" (fun _ ->
                started <- true
                publish "started" (Native.objectOf [ "pid", Native.get target "pid" ]))
            Native.on1 target "error" (fun error ->
                if started then fault "target" error
                else publish "failed" (Native.failure "spawn" error))
            Native.on2 target "exit" (fun code signal ->
                publish "exit" (Native.objectOf [ "code", code; "signal", signal ]))
            Native.on2 target "close" (fun _ _ ->
                targetClosed <- true
                Native.flush (Native.get Native.runtime "stdout") (fun error ->
                    if isNullOrUndefined error then stdoutFlushed <- true else fault "stdout" error
                    finish ())
                Native.flush (Native.get Native.runtime "stderr") (fun error ->
                    if isNullOrUndefined error then stderrFlushed <- true else fault "stderr" error
                    finish ())
                finish ())
            for channel in [ "stdout"; "stderr" ] do
                let output = Native.get Native.runtime channel
                let source = Native.get target channel
                Native.on1 source "error" (fault channel)
                Native.on1 output "error" (fault channel)
                Native.pipe source output false
            let input = Native.get target "stdin"
            // 目标关闭输入是独立事实，不中断仍须收齐的输出。
            Native.on1 input "error" ignore
            Native.on1 (Native.get Native.runtime "stdin") "error" (fault "stdin")
            Native.pipe (Native.get Native.runtime "stdin") input true
        with error ->
            fault "worker" (box error)

    let isEntry () =
        let arguments: string array = Native.runtime?argv
        arguments.Length = 4
        && arguments[1] = Native.filePath Native.moduleUrl
        && arguments[2] = "--wanxiangli-supervisor"
