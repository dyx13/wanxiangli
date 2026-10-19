module Wanxiangli.Time.TimeTesting

open Fable.Core.JsInterop
open Wanxiangli.Time

let private virtualTimerPort () : obj =
    let instance = VirtualTiming.createVirtualTimerPort ()
    createObj [ "port", box instance.Port; "advance", box instance.Advance; "nowMs", box instance.NowMs ]

let private virtualClockPort () : obj =
    let instance = VirtualTiming.createVirtualClockPort ()
    createObj [ "port", box instance.Port; "advanceMs", box instance.AdvanceMs; "set", box instance.Set ]

let TimeTesting: obj =
    createObj [
        "virtualTimerPort" ==> virtualTimerPort
        "virtualClockPort" ==> virtualClockPort
    ]
