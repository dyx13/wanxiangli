module Wanxiangli.Time.Time

open System
open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Time

/// JS 定时器等待上限（毫秒）。超过此值的等待必须由调用方分段。
let private maxTimerWaitMs: int = Deadline.MaxTimerWaitMs

[<Emit("typeof $0 === 'string' && $0.trim().length > 0")>]
let private hasTimeText (value: string) : bool = jsNative

let private parseIso (value: string) : DateTimeOffset =
    if not (hasTimeText value) then
        invalidArg "nowIso" "an explicit time string is required"

    DateTimeOffset.Parse(value)

/// Deadline 保持不透明：JS 面只接受 ISO 时刻与毫秒预算，返回不透明句柄，
/// 读取走 remainingMs / isExpired / nextWaitMs。
let private deadlineCreate (nowIso: string) (budgetMs: float) : Deadline =
    Deadline.ofBudget (parseIso nowIso) (TimeSpan.FromMilliseconds budgetMs)

let private deadlineRemainingMs (nowIso: string) (deadline: Deadline) : float =
    (Deadline.remaining (fun () -> parseIso nowIso) deadline).TotalMilliseconds

let private deadlineIsExpired (nowIso: string) (deadline: Deadline) : bool =
    Deadline.isExpired (fun () -> parseIso nowIso) deadline

let private deadlineNextWaitMs (nowIso: string) (deadline: Deadline) : int =
    Deadline.nextWaitMs (fun () -> parseIso nowIso) deadline

/// 具名导出容器：esbuild 静态绑定契约（export { Time }）。
/// 直接引用函数值（Fable 顶层多参 let 生成 uncurried JS 函数），
/// 不用显式 lambda —— curried lambda 会让 JS 双参调用拿到偏函数。
let Time: obj =
    createObj [
        "maxTimerWaitMs" ==> maxTimerWaitMs
        "deadlineCreate" ==> deadlineCreate
        "deadlineRemainingMs" ==> deadlineRemainingMs
        "deadlineIsExpired" ==> deadlineIsExpired
        "deadlineNextWaitMs" ==> deadlineNextWaitMs
    ]
