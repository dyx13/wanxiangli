namespace Wanxiangli.Supervision

open Fable.Core
open Fable.Core.JsInterop

[<AllowNullLiteral>]
type internal ProcessMessages =
    abstract started: unit -> JS.Promise<obj>
    abstract inspect: unit -> obj
    abstract read: channel: string * after: float -> obj
    abstract write: bytes: byte array -> JS.Promise<obj>
    abstract endInput: unit -> unit
    abstract signal: name: string -> obj
    abstract wait: milliseconds: float -> JS.Promise<obj>
    abstract takeOutput: unit -> JS.Promise<obj>
    abstract discardOutput: unit -> unit

module internal Native =
    [<Import("ProcessSession", "wanxiangli/process")>]
    let processSession: obj = jsNative
    [<Import("spawn", "node:child_process")>]
    let private spawnNode (_file: string) (_arguments: string array) (_options: obj): obj = jsNative
    [<Import("Transform", "node:stream")>]
    let private transform: obj = jsNative
    [<Emit("typeof globalThis.Bun !== 'undefined'")>]
    let private isBun (): bool = jsNative
    let spawn file arguments options =
        if isBun () then Wanxiangli.NativeProcess.BunProcess.spawn file arguments options
        else spawnNode file arguments options
    [<ImportDefault("node:process")>]
    let runtime: obj = jsNative
    [<ImportAll("node:fs")>]
    let files: obj = jsNative
    [<Import("tmpdir", "node:os")>]
    let temporaryDirectory (): string = jsNative
    [<Import("join", "node:path")>]
    let join (_left: string) (_right: string): string = jsNative
    [<Import("isAbsolute", "node:path")>]
    let isAbsolute (_path: string): bool = jsNative
    [<Import("fileURLToPath", "node:url")>]
    let filePath (_url: string): string = jsNative
    [<Emit("import.meta.url")>]
    let moduleUrl: string = jsNative
    [<Emit("$0 !== null && typeof $0 === 'object' && (Object.getPrototypeOf($0) === Object.prototype || Object.getPrototypeOf($0) === null)")>]
    let isObject (_value: obj): bool = jsNative
    [<Emit("Object.getOwnPropertyNames($0)")>]
    let names (_value: obj): string array = jsNative
    [<Emit("Object.getOwnPropertySymbols($0).length")>]
    let symbolCount (_value: obj): int = jsNative
    [<Emit("Object.getOwnPropertyDescriptor($0, $1)")>]
    let descriptor (_value: obj) (_name: string): obj = jsNative
    [<Emit("$0 != null && Object.prototype.hasOwnProperty.call($0, 'value')")>]
    let isValue (_value: obj): bool = jsNative
    [<Emit("typeof $0 === 'string' && $0.isWellFormed() && !$0.includes('\\0')")>]
    let isText (_value: obj): bool = jsNative
    [<Emit("Number.isSafeInteger($0) && $0 >= 0 && $0 <= $1")>]
    let isInteger (_value: obj) (_maximum: float): bool = jsNative
    [<Emit("Array.isArray($0)")>]
    let isArray (_value: obj): bool = jsNative
    [<Emit("Object.fromEntries($0)")>]
    let dictionary (_entries: (string * obj) array): obj = jsNative
    [<Emit("JSON.parse(JSON.stringify($0))")>]
    let copy (_value: obj): obj = jsNative
    [<Emit("new Promise($0)")>]
    let promise (_executor: (obj -> unit) -> unit): JS.Promise<obj> = jsNative
    [<Emit("Promise.resolve($0)")>]
    let resolved (_value: obj): JS.Promise<obj> = jsNative
    [<Emit("$0.then($1)")>]
    let mapPromise (_promise: JS.Promise<obj>) (_map: obj -> obj): JS.Promise<obj> = jsNative
    [<Emit("setTimeout($0, $1)")>]
    let timer (_callback: unit -> unit) (_milliseconds: int): obj = jsNative
    [<Emit("clearTimeout($0)")>]
    let clearTimer (_timer: obj): unit = jsNative
    [<Emit("setInterval($0, $1)")>]
    let interval (_callback: unit -> unit) (_milliseconds: int): obj = jsNative
    [<Emit("$0.on($1, $2)")>]
    let on1 (_target: obj) (_event: string) (_callback: obj -> unit): unit = jsNative
    [<Emit("$0.on($1, $2)")>]
    let on2 (_target: obj) (_event: string) (_callback: obj -> obj -> unit): unit = jsNative
    [<Emit("$0.pipe($1, { end: $2 })")>]
    let pipe (_source: obj) (_target: obj) (_end: bool): unit = jsNative
    [<Emit("""
      (() => {
        const counted = new $5({ transform(bytes, _encoding, callback) {
          try { $2(bytes.length); callback(null, bytes); }
          catch (error) { callback(error); }
        }});
        counted.on('error', $4);
        counted.once('end', $3);
        $0.pipe(counted).pipe($1, { end: false });
      })()
    """)>]
    let private forwardNative (_source: obj) (_target: obj) (_count: int -> unit) (_ended: unit -> unit) (_failed: obj -> unit) (_transform: obj): unit = jsNative

    let forward source target count ended failed = forwardNative source target count ended failed transform
    [<Emit("$0.kill(-$0.pid, 'SIGKILL')")>]
    let killOwnGroup (_runtime: obj): unit = jsNative

    let require condition message = if not condition then invalidOp message
    let get (value: obj) (name: string): obj = value?(name)
    let objectOf fields = createObj fields
    let value source name =
        let property = descriptor source name
        require (isValue property) ("Expected an own data field: " + name)
        get property "value"
    let fields expected source =
        require (isObject source && symbolCount source = 0) "Expected a plain data object"
        require (Array.sort (names source) = Array.sort (List.toArray expected)) "Unexpected or missing fields"
        for name in expected do value source name |> ignore
    let text allowEmpty source =
        require (isText source) "Expected valid text without NUL"
        let result: string = unbox source
        require (allowEmpty || result.Length > 0) "Text must not be empty"
        result
    let integer maximum source =
        require (isInteger source maximum) "Expected a non-negative safe integer within the limit"
        unbox<float> source
    let failure operation error =
        let code = get error "code"
        let message = get error "message"
        objectOf [ "operation", box operation
                   "code", (if isNullOrUndefined code then null else code)
                   "message", (if isNullOrUndefined message then box "Native operation failed" else box (string message)) ]
    let problem operation code message =
        objectOf [ "operation", box operation; "code", box code; "message", box message ]
    let exists path: bool = files?existsSync(path)
    let read path: obj = JS.JSON.parse (files?readFileSync(path, "utf8"))
    let publish directory name value =
        let pending = join directory (name + ".pending")
        (files?writeFileSync(pending, JS.JSON.stringify value, objectOf [ "mode", box 384 ]): unit)
        (files?renameSync(pending, join directory name): unit)
    let remove directory = (files?rmSync(directory, objectOf [ "recursive", box true; "force", box true ]): unit)
    let createDirectory () =
        let directory: string = files?mkdtempSync(join (temporaryDirectory ()) "wanxiangli-supervision-")
        (files?chmodSync(directory, 448): unit)
        directory

module internal Options =
    let read input =
        Native.fields [ "executable"; "args"; "cwd"; "env"; "tailBytes"; "maxWriteBytes" ] input
        for name in [ "executable"; "cwd" ] do
            Native.require (Native.isAbsolute (Native.value input name |> Native.text false)) (name + " must be absolute")
        let arguments = Native.value input "args"
        Native.require (Native.isArray arguments && Native.symbolCount arguments = 0) "args must be an array of data strings"
        let count: int = arguments?length
        Native.require ((Native.names arguments).Length = count + 1) "args contains extra properties or holes"
        let arguments = Array.init count (fun index -> Native.value arguments (string index) |> Native.text true)
        let environment = Native.value input "env"
        Native.require (Native.isObject environment && Native.symbolCount environment = 0) "env must be a plain data object"
        let entries =
            Native.names environment |> Array.map (fun name ->
                Native.text false (box name) |> ignore
                Native.require (not (name.Contains "=")) "Environment name contains equals"
                name, box (Native.value environment name |> Native.text true))
        let tail = Native.value input "tailBytes" |> Native.integer 16777216.
        let write = Native.value input "maxWriteBytes" |> Native.integer 16777216.
        Native.require (write > 0.) "maxWriteBytes must be positive"
        let platform: string = Native.runtime?platform
        Native.require (platform = "linux" || platform = "darwin") "POSIX process groups are required"
        Native.objectOf [ "executable", Native.value input "executable"; "args", box arguments
                          "cwd", Native.value input "cwd"; "env", Native.dictionary entries
                          "tailBytes", box tail; "maxWriteBytes", box write ]
