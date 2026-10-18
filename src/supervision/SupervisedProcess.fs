module Wanxiangli.Supervision.SupervisedProcess

open System.Collections.Generic
open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Supervision

[<AllowNullLiteral>]
type SupervisedMessages =
    abstract started: unit -> JS.Promise<obj>
    abstract inspect: unit -> obj
    abstract read: channel: string * after: float -> obj
    abstract write: bytes: byte array -> JS.Promise<obj>
    abstract endInput: unit -> unit
    abstract signal: name: string -> obj
    abstract wait: milliseconds: float -> JS.Promise<obj>
    abstract takeOutput: unit -> JS.Promise<obj>
    abstract discardOutput: unit -> unit

do
    if Worker.isEntry () then
        let arguments: string array = Native.runtime?argv
        Worker.run arguments[3]

let SupervisedProcess (input: obj): SupervisedMessages =
    let options = Options.read input
    let directory = Native.createDirectory ()
    let inner: ProcessMessages =
        try
            Native.publish directory "request" options
            let workerOptions =
                Native.objectOf [ "executable", Native.get Native.runtime "execPath"
                                  "args", box [| Native.filePath Native.moduleUrl; "--wanxiangli-supervisor"; directory |]
                                  "cwd", box (Native.temporaryDirectory ()); "env", Native.objectOf []
                                  "tailBytes", Native.get options "tailBytes"; "maxWriteBytes", Native.get options "maxWriteBytes" ]
            createNew Native.processSession (workerOptions, "Capture") |> unbox
        with _ ->
            Native.remove directory
            reraise ()
    let mutable busy = false
    let mutable targetPid: obj = null
    let mutable targetExit: obj = null
    let mutable failure: obj = null
    let mutable startResult: obj = null
    let mutable targetClosed = false
    let mutable targetOutput: (float * float) option = None
    let mutable shutdownRequested = false
    let mutable outputInterrupted = false
    let mutable controlFailed = false
    let mutable closed = false
    let mutable capture = "Open"
    let mutable pollTimer: obj = null
    let mutable reportStart: obj -> unit = ignore
    let startup = Native.promise (fun resolve -> reportStart <- resolve)
    let waits = Dictionary<float, unit -> unit>()
    let mutable nextWait = 0.

    let guard action =
        Native.require (not busy) "SupervisedProcess does not allow reentrant messages"
        busy <- true
        try action () finally busy <- false

    let remember detail =
        if isNull failure then failure <- Native.copy detail

    let settleStart result =
        if isNull startResult then
            startResult <- Native.copy result
            if unbox<string> (Native.get result "kind") = "Failed" then
                capture <- "Discarded"
                inner.discardOutput ()
            reportStart (Native.copy result)

    let snapshot () =
        let worker = inner.inspect ()
        let workerPhase: string = worker?phase
        let phase =
            if closed then "Closed"
            elif targetClosed || not (isNull targetExit) || workerPhase = "Closed" || workerPhase = "Draining" then "Draining"
            elif isNull targetPid then "Starting"
            else "Running"
        Native.objectOf [ "phase", box phase; "pid", targetPid
                          "exit", (if isNull targetExit then null else Native.copy targetExit)
                          "failure", (if isNull failure then null else Native.copy failure)
                          "stdin", Native.get worker "stdin"; "stdout", Native.get worker "stdout"; "stderr", Native.get worker "stderr"
                          "capture", box capture
                          "supervisor", Native.objectOf [ "pid", Native.get worker "pid"
                                                          "phase", box workerPhase
                                                          "exit", Native.get worker "exit"
                                                          "failure", Native.get worker "failure" ] ]

    let shutdown () =
        if not shutdownRequested then
            let result = inner.signal "SIGKILL"
            let kind: string = result?kind
            if kind = "Requested" then shutdownRequested <- true
            elif kind = "Failed" then remember (Native.get result "error")

    let readIfPresent name apply =
        let path = Native.join directory name
        if Native.exists path then apply (Native.read path)

    let refresh () =
        if not closed then
            if not controlFailed then
                try
                    Native.require (Native.exists directory) "Supervisor control directory is missing"
                    if isNull startResult then
                        readIfPresent "started" (fun receipt ->
                            Native.fields [ "pid" ] receipt
                            let pid = Native.value receipt "pid"
                            Native.integer 2147483647. pid |> ignore
                            Native.require (unbox<float> pid > 0.) "Invalid target PID"
                            targetPid <- pid
                            settleStart (Native.objectOf [ "kind", box "Started"; "pid", pid ]))
                        if isNull startResult then
                            readIfPresent "failed" (fun detail ->
                                remember detail
                                settleStart (Native.objectOf [ "kind", box "Failed"; "error", detail ]))
                    if isNull targetExit then
                        readIfPresent "exit" (fun receipt ->
                            Native.fields [ "code"; "signal" ] receipt
                            let code = Native.value receipt "code"
                            let signal = Native.value receipt "signal"
                            if not (isNull code) then Native.integer 2147483647. code |> ignore
                            if not (isNull signal) then Native.text false signal |> ignore
                            Native.require (not (isNull code && isNull signal)) "Target exit has no status"
                            targetExit <- receipt)
                    if not targetClosed then
                        readIfPresent "closed" (fun receipt ->
                            Native.fields [ "closed"; "stdoutBytes"; "stderrBytes" ] receipt
                            Native.require (Native.value receipt "closed" = box true) "Invalid closed witness"
                            let stdout = Native.value receipt "stdoutBytes" |> Native.integer 9007199254740991.
                            let stderr = Native.value receipt "stderrBytes" |> Native.integer 9007199254740991.
                            targetOutput <- Some(stdout, stderr)
                            targetClosed <- true)
                    readIfPresent "fault" (fun detail ->
                        remember detail
                        controlFailed <- true)
                with error ->
                    controlFailed <- true
                    remember (Native.failure "control" (box error))
            let failedStart = not (isNull startResult) && unbox<string> (Native.get startResult "kind") = "Failed"
            let worker = inner.inspect ()
            let stdout: float = Native.get (Native.get worker "stdout") "observed" |> unbox
            let stderr: float = Native.get (Native.get worker "stderr") "observed" |> unbox
            let outputReceived =
                match targetOutput with
                | Some(expectedOut, expectedErr) ->
                    if stdout > expectedOut || stderr > expectedErr then
                        controlFailed <- true
                        remember (Native.problem "output" "OUTPUT_COUNT_MISMATCH" "Received output exceeds the worker extent")
                    stdout = expectedOut && stderr = expectedErr
                | None -> false
            if (targetClosed && (outputReceived || capture = "Discarded")) || controlFailed || failedStart then shutdown ()
            let workerPhase: string = worker?phase
            if workerPhase = "Draining" || workerPhase = "Closed" then
                if isNull startResult then
                    let detail = Native.problem "supervision" "UNKNOWN_TARGET_START" "Supervisor ended without a target startup receipt"
                    remember detail
                    settleStart (Native.objectOf [ "kind", box "Failed"; "error", detail ])
                if isNull targetExit && unbox<string> (Native.get startResult "kind") <> "Failed" then
                    remember (Native.problem "supervision" "UNKNOWN_TARGET_EXIT" "Supervisor ended without a target exit receipt")
                elif not targetClosed && not shutdownRequested then
                    remember (Native.problem "supervision" "SUPERVISOR_LOST" "Supervisor ended before output closure was confirmed")
            if workerPhase = "Closed" && capture <> "Open" then
                closed <- true
                Native.clearTimer pollTimer
                try Native.remove directory
                with error -> remember (Native.failure "cleanup" (box error))
                for finish in waits.Values |> Seq.toArray do finish ()

    let rec poll () =
        refresh ()
        if not closed then pollTimer <- Native.timer poll 5

    let waitResult kind = Native.objectOf [ "kind", box kind; "state", snapshot () ]

    let wait milliseconds =
        guard (fun () ->
            Native.integer 2147483647. (box milliseconds) |> ignore
            Native.require (milliseconds > 0.) "Wait duration must be positive"
            refresh ()
            if closed then Native.resolved (waitResult "Closed")
            else
                Native.promise (fun resolve ->
                    let id = nextWait
                    nextWait <- nextWait + 1.
                    let mutable finished = false
                    let mutable timer: obj = null
                    let finish kind =
                        if not finished then
                            finished <- true
                            waits.Remove id |> ignore
                            Native.clearTimer timer
                            resolve (waitResult kind)
                    waits.Add(id, fun () -> finish "Closed")
                    timer <- Native.timer (fun () -> finish "TimedOut") (int milliseconds)))

    let takeOutput () =
        guard (fun () ->
            Native.mapPromise (inner.takeOutput ()) (fun result ->
                let kind: string = result?kind
                match kind with
                | "Closed" ->
                    refresh ()
                    match targetOutput with
                    | Some(expectedOut, expectedErr) ->
                        let worker = inner.inspect ()
                        let stdout: float = Native.get (Native.get worker "stdout") "observed" |> unbox
                        let stderr: float = Native.get (Native.get worker "stderr") "observed" |> unbox
                        if stdout <> expectedOut || stderr <> expectedErr then
                            let code = if outputInterrupted then "OUTPUT_INTERRUPTED" else "OUTPUT_INCOMPLETE"
                            remember (Native.problem "output" code "Capture ended before the complete worker extent was received")
                    | None -> ()
                    capture <- "Closed"
                    refresh ()
                    Native.objectOf [ "kind", box "Closed"; "state", snapshot () ]
                | "Failed" ->
                    capture <- "Failed"
                    remember (Native.get result "error")
                    shutdown ()
                    refresh ()
                    result
                | "Discarded" ->
                    capture <- "Discarded"
                    refresh ()
                    result
                | _ -> result))

    do pollTimer <- Native.timer poll 0

    { new SupervisedMessages with
        member _.started() = Native.mapPromise startup Native.copy
        member _.inspect() = guard (fun () ->
            refresh ()
            snapshot ())
        member _.read(channel, after) = guard (fun () -> inner.read(channel, after))
        member _.write(bytes) = guard (fun () -> inner.write bytes)
        member _.endInput() = guard (fun () -> inner.endInput ())
        member _.signal(name) = guard (fun () ->
            let result = inner.signal name
            if name = "SIGKILL" && unbox<string> (Native.get result "kind") = "Requested" then
                shutdownRequested <- true
                outputInterrupted <- true
            result)
        member _.wait(milliseconds) = wait milliseconds
        member _.takeOutput() = takeOutput ()
        member _.discardOutput() = guard (fun () ->
            capture <- "Discarded"
            inner.discardOutput ()
            refresh ()) }
