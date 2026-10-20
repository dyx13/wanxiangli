namespace Wanxiangli.Prefix

open Fable.Core
open Fable.Core.JsInterop
open Wanxiangli.Prefix.Generation

/// wanxiangli/prefix 公开入口。无状态 owner：世代推进、候选与提交、
/// 检查点窗口和同代追加律都是纯判定；JS 边界只收发冻结的 plain data。
/// 本对象不调用 Trace、宿主或存储；持久化与写入由组合者负责。
[<AttachMembers>]
type Prefix() =

    static let stateOf (value: obj) : State =
        { Epoch = Wire.epoch value "epoch"
          CompactionRuns = Set.ofList (Wire.strings value "compactionRuns")
          Tenures = Set.ofList (Wire.strings value "tenures") }

    static let stateView encoding (state: State) : obj =
        Wire.freeze (
            createObj
                [ "epoch" ==> Wire.epochValue encoding state.Epoch
                  "compactionRuns" ==> Wire.stringArray state.CompactionRuns
                  "tenures" ==> Wire.stringArray state.Tenures ]
        )

    static let evidenceOf (value: obj) : Evidence =
        match Wire.text value "kind" with
        | "compaction" -> Compaction(Wire.text value "run")
        | "tenure" -> Tenure(Wire.text value "incumbencyId")
        | other -> Wire.fail $"prefix: unknown evidence kind '%s{other}'"

    static let evidenceView (evidence: Evidence) : obj =
        match evidence with
        | Compaction run -> Wire.freeze (createObj [ "kind" ==> "compaction"; "run" ==> run ])
        | Tenure incumbency -> Wire.freeze (createObj [ "kind" ==> "tenure"; "incumbencyId" ==> incumbency ])

    static let candidateOf encoding (value: obj) : Candidate =
        { PreviousEpoch = Wire.lineEpoch encoding value "previousEpoch"
          NextEpoch = Wire.lineEpoch encoding value "nextEpoch"
          Evidence = evidenceOf (Wire.get value "evidence") }

    static let candidateView encoding (candidate: Candidate option) : obj =
        match candidate with
        | None -> null
        | Some candidate ->
            Wire.freeze (
                createObj
                    [ "previousEpoch" ==> Wire.epochValue encoding candidate.PreviousEpoch
                      "nextEpoch" ==> Wire.epochValue encoding candidate.NextEpoch
                      "evidence" ==> evidenceView candidate.Evidence ]
            )

    static let rejectionView encoding (rejection: Rejection) : obj =
        let fields =
            match rejection with
            | StaleEpoch(expected, actual) ->
                [ "error" ==> "StaleEpoch"
                  "expected" ==> Wire.epochValue encoding expected
                  "actual" ==> Wire.epochValue encoding actual ]
            | NonSequentialEpoch -> [ "error" ==> "NonSequentialEpoch" ]
            | AlreadyReanchored evidence -> [ "error" ==> "AlreadyReanchored"; "evidence" ==> evidenceView evidence ]

        Wire.freeze (createObj ([ "ok" ==> false; "absorbed" ==> absorbed rejection ] @ fields))

    static let wireOf (value: obj) : WireLaw.Wire =
        { Provider = Wire.optionalText value "provider"
          Model = Wire.optionalText value "model"
          Variant = Wire.optionalText value "variant"
          Tools = Wire.strings value "tools"
          System = Wire.strings value "system"
          Messages = Wire.strings value "messages" }

    /// 第 0 代：没有推进过任何证据。
    member _.empty() : obj = stateView Wire.Number Generation.empty

    /// 校验并规范化一份状态（去重、排序、冻结）。畸形输入抛 TypeError。
    member _.normalize(state: obj) : obj = stateView (Wire.epochEncoding state "epoch") (stateOf state)

    member _.isReanchored(state: obj, evidence: obj) : bool =
        Generation.isReanchored (evidenceOf evidence) (stateOf state)

    /// 为一条证据提议推进行；已推进过的证据返回 null。不改变状态。
    member _.propose(state: obj, evidence: obj) : obj =
        candidateView (Wire.epochEncoding state "epoch") (Generation.propose (evidenceOf evidence) (stateOf state))

    /// 在观察到的压缩伪 run（旧到新）中，为最新一个未推进的提议推进行。
    member _.proposeCompaction(state: obj, observedRuns: obj) : obj =
        let runs = Wire.strings (createObj [ "observedRuns" ==> observedRuns ]) "observedRuns"
        candidateView (Wire.epochEncoding state "epoch") (Generation.proposeCompaction runs (stateOf state))

    /// 提交一行：{ ok: true, state } 或 { ok: false, error, absorbed, ... }。
    /// absorbed 为 true 表示重放/重复观察，调用方应保持原状态、不报告错误。
    member _.commit(state: obj, candidate: obj) : obj =
        let encoding = Wire.epochEncoding state "epoch"

        match Generation.commit (candidateOf encoding candidate) (stateOf state) with
        | Ok next -> Wire.freeze (createObj [ "ok" ==> true; "state" ==> stateView encoding next ])
        | Error rejection -> rejectionView encoding rejection

    /// 检查点窗口追加：同一调用身份重入不产生第二个检查点。返回新数组。
    member _.appendCheckpoint(window: obj, callId: obj) : obj =
        let current = Wire.strings (createObj [ "window" ==> window ]) "window"
        let id = Wire.text (createObj [ "callId" ==> callId ]) "callId"
        Wire.stringArray (Checkpoints.append id current)

    /// 同代追加律：{ append, breaks }。breaks 为空即 next 保留 previous 为精确前缀。
    member _.classify(previous: obj, next: obj) : obj =
        let breaks = WireLaw.classify (wireOf previous) (wireOf next)

        Wire.freeze (
            createObj
                [ "append" ==> List.isEmpty breaks
                  "breaks" ==> Wire.stringArray (breaks |> List.map WireLaw.label) ]
        )
