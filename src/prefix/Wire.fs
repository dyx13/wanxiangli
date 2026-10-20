namespace Wanxiangli.Prefix

open Fable.Core
open Fable.Core.JsInterop

/// JS 边界的 plain-data 读取合同。解码失败一律抛 TypeError，不猜测回退。
module internal Wire =

    type EpochEncoding =
        | Number
        | DecimalString

    [<Emit("typeof $0 === 'string'")>]
    let isString (_value: obj) : bool = jsNative

    [<Emit("$0 === null || $0 === undefined")>]
    let isNullOrUndefined (_value: obj) : bool = jsNative

    [<Emit("$0 !== null && typeof $0 === 'object' && !Array.isArray($0)")>]
    let isObject (_value: obj) : bool = jsNative

    [<Emit("Array.isArray($0)")>]
    let isArray (_value: obj) : bool = jsNative

    [<Emit("Number.isSafeInteger($0)")>]
    let isSafeInteger (_value: obj) : bool = jsNative

    [<Emit("(() => { throw new TypeError($0) })()")>]
    let fail (_message: string) : 'a = jsNative

    [<Emit("Object.freeze($0)")>]
    let freeze (_value: obj) : obj = jsNative

    let get (value: obj) (key: string) : obj = value?(key)

    let text (value: obj) (key: string) : string =
        let raw = if isObject value then get value key else null

        if isString raw && (unbox<string> raw).Length > 0 then
            unbox<string> raw
        else
            fail $"prefix: field '%s{key}' must be a non-empty string"

    let optionalText (value: obj) (key: string) : string option =
        let raw = if isObject value then get value key else null

        if isNullOrUndefined raw then None
        elif isString raw then Some(unbox<string> raw)
        else fail $"prefix: field '%s{key}' must be a string or null"

    [<Emit("typeof $0 === 'string' && /^(0|[1-9][0-9]*|-[1-9][0-9]*)$/.test($0)")>]
    let private isEpochText (_value: obj) : bool = jsNative

    [<Emit("BigInt($0)")>]
    let private integerOf (_value: obj) : bigint = jsNative

    let epochEncoding (value: obj) (key: string) : EpochEncoding =
        let raw = if isObject value then get value key else null

        if isSafeInteger raw then Number
        elif isEpochText raw then DecimalString
        else fail $"prefix: field '%s{key}' must be a safe integer or canonical decimal epoch"

    let private readEpoch (value: obj) (key: string) : bigint =
        epochEncoding value key |> ignore
        integerOf (get value key)

    /// 现行世代非负；数字编码只接受安全整数，字符串编码保持精确。
    let epoch (value: obj) (key: string) : bigint =
        let raw = readEpoch value key

        if raw >= 0I then
            raw
        else
            fail $"prefix: field '%s{key}' must be a non-negative integer epoch"

    /// 行的负世代号仍由 commit 判定；同一提交必须使用状态的编码。
    let lineEpoch (encoding: EpochEncoding) (value: obj) (key: string) : bigint =
        if epochEncoding value key <> encoding then
            fail "prefix: state and candidate epoch encodings must match"

        readEpoch value key

    let epochValue (encoding: EpochEncoding) (value: bigint) : obj =
        match encoding with
        | DecimalString -> box (string value)
        | Number when value >= -9007199254740991I && value <= 9007199254740991I ->
            emitJsExpr value "Number($0)"
        | Number ->
            fail "prefix: a safe successor epoch is unavailable"

    let strings (value: obj) (key: string) : string list =
        let raw = if isObject value then get value key else null

        if not (isArray raw) then
            fail $"prefix: field '%s{key}' must be an array of strings"
        else
            unbox<obj array> raw
            |> Array.toList
            |> List.map (fun item ->
                if isString item then
                    unbox<string> item
                else
                    fail $"prefix: field '%s{key}' must contain only strings")

    let stringArray (items: string seq) : obj = freeze (box (Seq.toArray items))
