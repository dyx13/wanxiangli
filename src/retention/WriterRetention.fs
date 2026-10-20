module Wanxiangli.Retention.WriterRetention

open Fable.Core
open Fable.Core.JsInterop

[<Emit("Number.isFinite($0)")>]
let private isFinite (value: obj) : bool = jsNative

[<Emit("Array.isArray($0)")>]
let private isArray (value: obj) : bool = jsNative

let private dayMilliseconds = 24.0 * 60.0 * 60.0 * 1000.0

/// 非有限时间不是“很久以前”：把它当过期会删掉仍要服务的 writer，故直接拒绝。
let private requireTime (name: string) (value: obj) : float =
    if isFinite value then unbox<float> value
    else raise (System.ArgumentException(name + " must be a finite millisecond timestamp"))

let private utcDayOf (timeMs: float) = floor (timeMs / dayMilliseconds)

let private retained (nowMs: float) (lastActivityMs: float) =
    utcDayOf lastActivityMs >= utcDayOf nowMs - 1.0

[<Emit("(() => { try { return JSON.parse($0) } catch (_) { return undefined } })()")>]
let private tryParseJson (line: string) : obj = jsNative

[<Emit("typeof $0 === 'string'")>]
let private isString (value: obj) : bool = jsNative

[<Emit("$0 !== null && typeof $0 === 'object' && !Array.isArray($0)")>]
let private isPlainObject (value: obj) : bool = jsNative

[<Emit("Date.parse($0)")>]
let private parseDateMs (value: string) : float = jsNative

[<Emit("$0[Symbol.iterator]()")>]
let private iteratorOf (value: obj) : obj = jsNative

[<Emit("$0 != null && typeof $0[Symbol.iterator] === 'function'")>]
let private isIterable (value: obj) : bool = jsNative

/// 尾行能说明什么活动。
type private TailKind =
    | Observed of float
    | CutTail
    | Silent

let private classify (line: string) : TailKind =
    let value = tryParseJson line
    if not (isPlainObject value) then Silent
    else
        match value?event_type with
        | eventType when isString eventType && unbox<string> eventType = "JournalEnvelope" ->
            let payload: obj = value?payload
            if not (isPlainObject payload) || not (isString payload?ObservedAt) then Silent
            else
                let observedAt = parseDateMs (unbox<string> payload?ObservedAt)
                if isFinite (box observedAt) then Observed observedAt else Silent
        | eventType when isString eventType && unbox<string> eventType = "ProjectionCutTail" -> CutTail
        | _ -> Silent

/// writer 保留规则只读调用方给出的截止时刻与活动时刻，不读时钟或文件。
[<AttachMembers>]
type WriterRetention() =
    member _.dayMilliseconds = dayMilliseconds

    member _.utcDay(timeMs: obj) : float = utcDayOf (requireTime "timeMs" timeMs)

    member _.isRetained(nowMs: obj, lastActivityMs: obj) : bool =
        retained (requireTime "nowMs" nowMs) (requireTime "lastActivityMs" lastActivityMs)

    member _.retain(nowMs: obj, writers: obj) : obj array =
        let now = requireTime "nowMs" nowMs
        if not (isArray writers) then
            raise (System.ArgumentException "writers must be an array")
        unbox<obj array> writers
        |> Array.filter (fun writer ->
            if isNull writer then raise (System.ArgumentException "writer must be an object")
            retained now (requireTime "lastActivityMs" writer?lastActivityMs))

    member _.classifyTail(line: obj) : obj =
        if not (isString line) then raise (System.ArgumentException "line must be a string")
        match classify (unbox<string> line) with
        | Observed observedAt -> createObj [ "kind", box "observed"; "observedAtMs", box observedAt ]
        | CutTail -> createObj [ "kind", box "cutTail" ]
        | Silent -> createObj [ "kind", box "silent" ]

    /// 只拉取到第一个结论；资源由提供惰性迭代器的调用方关闭。
    member _.lastActivity(linesNewestFirst: obj) : obj =
        if not (isIterable linesNewestFirst) then
            raise (System.ArgumentException "linesNewestFirst must be iterable")
        let iterator = iteratorOf linesNewestFirst
        // DSL-MUTABLE: algorithm-scratch — one pull loop; stops at the first verdict.
        let mutable verdict: obj option = None
        while verdict.IsNone do
            let step: obj = iterator?next ()
            if unbox<bool> step?``done`` then verdict <- Some null
            else
                let line: obj = step?value
                if not (isString line) then raise (System.ArgumentException "each line must be a string")
                match classify (unbox<string> line) with
                | Observed observedAt -> verdict <- Some(box observedAt)
                | CutTail -> ()
                | Silent -> verdict <- Some null
        verdict.Value
