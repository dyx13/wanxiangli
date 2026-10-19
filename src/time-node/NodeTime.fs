module Wanxiangli.Time.NodeTime

open Fable.Core.JsInterop
open Wanxiangli.Time

let NodeTime: obj =
    createObj [
        "nodeTimerPort" ==> NodeTiming.nodeTimerPort
        "nodeClockPort" ==> NodeTiming.nodeClockPort
        "timerTask" ==> NodeTiming.timerTask
        "raceExit" ==> NodeTiming.raceExit
    ]
