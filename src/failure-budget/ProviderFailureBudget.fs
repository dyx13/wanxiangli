module Wanxiangli.FailureBudget.ProviderFailureBudget

open Fable.Core
open Fable.Core.JsInterop

[<Emit("typeof $0 === 'string'")>]
let private isString (_value: obj) : bool = jsNative

[<Emit("typeof $0 === 'boolean'")>]
let private isBool (_value: obj) : bool = jsNative

[<Emit("Number.isSafeInteger($0)")>]
let private isSafeInteger (_value: obj) : bool = jsNative

[<Emit("$0 !== null && typeof $0 === 'object' && !Array.isArray($0)")>]
let private isObject (_value: obj) : bool = jsNative

[<Emit("Array.isArray($0)")>]
let private isArray (_value: obj) : bool = jsNative

[<Emit("$0 === null")>]
let private isNullValue (_value: obj) : bool = jsNative

[<Emit("$0[$1]")>]
let private field (_value: obj) (_name: string) : obj = jsNative

[<Emit("Object.freeze($0)")>]
let private freeze (_value: obj) : obj = jsNative

[<Emit("Object.freeze(Array.from($0))")>]
let private frozenArray (_value: string[]) : obj = jsNative

[<Emit("Array.from($0)")>]
let private arrayOf (_value: obj) : obj[] = jsNative

let private malformed (what: string) : 'T =
    raise (System.ArgumentException(sprintf "wanxiangli/failure-budget: malformed %s" what))

/// Identities are opaque text: any string (the host never constrained their content), never a non-string.
let private text (what: string) (value: obj) : string =
    if isString value then
        unbox<string> value
    else
        malformed what

let private count (what: string) (value: obj) : int =
    if isSafeInteger value && unbox<int> value >= 0 then
        unbox<int> value
    else
        malformed what

let private flag (what: string) (value: obj) : bool =
    if isBool value then unbox<bool> value else malformed what

/// The consecutive failure limit of one Logical Run's automatic recovery.
[<Literal>]
let DefaultBudget = 12

/// How many exact attempt keys the projection remembers for deduplication.
[<Literal>]
let DedupeWindow = 32

type private State =
    { LogicalRun: string
      AuthorityRoot: string
      Failures: int
      Keys: string list
      Exhausted: bool
      LastWasSuccess: bool }

let private stateOf (value: obj) : State =
    if not (isObject value) then
        malformed "state"

    let keys = field value "recentFailureKeys"

    if not (isArray keys) then
        malformed "state.recentFailureKeys"

    { LogicalRun = text "state.logicalRun" (field value "logicalRun")
      AuthorityRoot = text "state.authorityRoot" (field value "authorityRoot")
      Failures = count "state.consecutiveFailureCount" (field value "consecutiveFailureCount")
      Keys = arrayOf keys |> Array.map (text "state.recentFailureKeys[]") |> List.ofArray
      Exhausted = flag "state.exhausted" (field value "exhausted")
      LastWasSuccess = flag "state.lastTransitionWasSuccess" (field value "lastTransitionWasSuccess") }

let private view (s: State) : obj =
    freeze (
        createObj
            [ "logicalRun" ==> s.LogicalRun
              "authorityRoot" ==> s.AuthorityRoot
              "consecutiveFailureCount" ==> s.Failures
              "recentFailureKeys" ==> frozenArray (Array.ofList s.Keys)
              "exhausted" ==> s.Exhausted
              "lastTransitionWasSuccess" ==> s.LastWasSuccess ]
    )

let private limitOf (value: obj) = count "budgetLimit" value

/// The exact attempt identity (session, logical run, authority root, provider run) joined by U+001F,
/// byte-for-byte the key the host's projection has always remembered.
let private dedupeKey (identity: obj) : string =
    if not (isObject identity) then
        malformed "identity"

    [ text "identity.sessionId" (field identity "sessionId")
      text "identity.logicalRun" (field identity "logicalRun")
      text "identity.authorityRoot" (field identity "authorityRoot")
      text "identity.providerRun" (field identity "providerRun") ]
    |> String.concat "\u001f"

let private forAuthority (logicalRun: obj) (authorityRoot: obj) : obj =
    view
        { LogicalRun = text "logicalRun" logicalRun
          AuthorityRoot = text "authorityRoot" authorityRoot
          Failures = 0
          Keys = []
          Exhausted = false
          LastWasSuccess = false }

let private rejected (reason: string) : obj =
    freeze (createObj [ "ok" ==> false; "rejection" ==> reason ])

/// One failure record advances the streak exactly once: an exhausted run takes nothing,
/// another run or authority root is not this budget, a remembered exact attempt is
/// already counted, and the recorded count must be the successor of the folded count.
let private applyFailure (identity: obj) (nextCount: obj) (current: obj) : obj =
    let s = stateOf current
    let key = dedupeKey identity
    let next = count "consecutiveFailureCount" nextCount

    if s.Exhausted then
        rejected "AlreadyExhausted"
    elif
        text "identity.logicalRun" (field identity "logicalRun") <> s.LogicalRun
        || text "identity.authorityRoot" (field identity "authorityRoot")
           <> s.AuthorityRoot
    then
        rejected "DifferentRun"
    elif List.contains key s.Keys then
        rejected "AlreadyObserved"
    elif next <> s.Failures + 1 then
        rejected "InvalidTransition"
    else
        let remembered =
            key :: (s.Keys |> List.filter ((<>) key)) |> List.truncate DedupeWindow

        freeze (
            createObj
                [ "ok" ==> true
                  "state"
                  ==> view
                          { s with
                              Failures = next
                              Keys = remembered
                              LastWasSuccess = false } ]
        )

let private applyExhausted (current: obj) : obj =
    view
        { stateOf current with
            Exhausted = true }

/// Business-main success clears the streak and forgets the attempt keys.
let private recordSuccess (current: obj) : obj =
    view
        { stateOf current with
            Failures = 0
            Keys = []
            LastWasSuccess = true }

let private verdict (budgetLimit: obj) (failures: obj) : string =
    if count "consecutiveFailureCount" failures >= limitOf budgetLimit then
        "Exhausted"
    else
        "MayRetry"

let private mayRetry (budgetLimit: obj) (current: obj) : bool =
    let s = stateOf current
    let limit = limitOf budgetLimit
    not s.Exhausted && s.Failures < limit

/// A failure that was already counted is answered from the record, never counted again:
/// only the latest exact attempt may still be retried (if budget remains); an older one
/// belongs to a superseded episode.
let private replay (budgetLimit: obj) (identity: obj) (current: obj) : string =
    let s = stateOf current
    let key = dedupeKey identity

    match List.tryHead s.Keys with
    | Some latest when latest = key ->
        if mayRetry budgetLimit current then
            "RetryAuthorized"
        else
            "RetryExhausted"
    | _ -> "EpisodeSuperseded"

type private RecordedSpec = { Version: int; Limit: int }

type private RecordedFailure =
    { Key: string
      Count: int
      Reason: string }

type private RecordedState =
    { LogicalRun: string
      AuthorityRoot: string
      Failures: int
      Spec: RecordedSpec option
      Observed: RecordedFailure list
      SuccessKeys: string list
      Exhausted: bool
      LastWasSuccess: bool }

let private recordedInteger name value =
    if isSafeInteger value then
        unbox<int> value
    else
        malformed name

let private recordedSpecOf (value: obj) : RecordedSpec =
    if not (isObject value) then
        malformed "budgetSpec"

    { Version = recordedInteger "budgetSpec.version" (field value "version")
      Limit = recordedInteger "budgetSpec.limit" (field value "limit") }

let private recordedSpecView (spec: RecordedSpec) : obj =
    freeze (createObj [ "version" ==> spec.Version; "limit" ==> spec.Limit ])

let private recordedStateOf (value: obj) : RecordedState =
    if not (isObject value) then
        malformed "recorded state"

    let observed = field value "observedFailures"
    let successes = field value "successKeys"

    if not (isArray observed) then
        malformed "state.observedFailures"

    if not (isArray successes) then
        malformed "state.successKeys"

    let spec = field value "budgetSpec"

    { LogicalRun = text "state.logicalRun" (field value "logicalRun")
      AuthorityRoot = text "state.authorityRoot" (field value "authorityRoot")
      Failures = count "state.consecutiveFailureCount" (field value "consecutiveFailureCount")
      Spec = if isNullValue spec then None else Some(recordedSpecOf spec)
      Observed =
        arrayOf observed
        |> Array.map (fun failure ->
            if not (isObject failure) then
                malformed "state.observedFailures[]"

            { Key = text "failure.key" (field failure "key")
              Count = count "failure.count" (field failure "count")
              Reason = text "failure.reason" (field failure "reason") })
        |> List.ofArray
      SuccessKeys = arrayOf successes |> Array.map (text "state.successKeys[]") |> List.ofArray
      Exhausted = flag "state.exhausted" (field value "exhausted")
      LastWasSuccess = flag "state.lastTransitionWasSuccess" (field value "lastTransitionWasSuccess") }

let private recordedView (state: RecordedState) : obj =
    let observed =
        state.Observed
        |> List.map (fun failure ->
            freeze (
                createObj
                    [ "key" ==> failure.Key
                      "count" ==> failure.Count
                      "reason" ==> failure.Reason ]
            ))
        |> List.toArray
        |> box
        |> freeze

    freeze (
        createObj
            [ "logicalRun" ==> state.LogicalRun
              "authorityRoot" ==> state.AuthorityRoot
              "consecutiveFailureCount" ==> state.Failures
              "budgetSpec" ==> (state.Spec |> Option.map recordedSpecView |> Option.toObj)
              "observedFailures" ==> observed
              "successKeys" ==> frozenArray (List.toArray state.SuccessKeys)
              "exhausted" ==> state.Exhausted
              "lastTransitionWasSuccess" ==> state.LastWasSuccess ]
    )

let private recordedResult decision =
    match decision with
    | Ok state -> freeze (createObj [ "ok" ==> true; "state" ==> recordedView state ])
    | Error reason -> rejected reason

let private recordedForAuthority logicalRun authorityRoot =
    recordedView
        { LogicalRun = text "logicalRun" logicalRun
          AuthorityRoot = text "authorityRoot" authorityRoot
          Failures = 0
          Spec = None
          Observed = []
          SuccessKeys = []
          Exhausted = false
          LastWasSuccess = false }

let private recordedSpecValid (spec: RecordedSpec) = spec.Version = 1 && spec.Limit > 0

let private recordedDifferentRun identity (state: RecordedState) =
    text "identity.logicalRun" (field identity "logicalRun") <> state.LogicalRun
    || text "identity.authorityRoot" (field identity "authorityRoot")
       <> state.AuthorityRoot

let private recordedAdvance identity spec next reason (state: RecordedState) =
    let key = dedupeKey identity

    match state.Observed |> List.tryFind (fun failure -> failure.Key = key) with
    | _ when recordedDifferentRun identity state -> Error "DifferentRun"
    | _ when not (recordedSpecValid spec) || (state.Spec |> Option.exists ((<>) spec)) -> Error "InvalidBudget"
    | _ when List.contains key state.SuccessKeys -> Error "ConflictingObservation"
    | Some failure when failure.Count = next && failure.Reason = reason -> Error "AlreadyObserved"
    | Some _ -> Error "ConflictingObservation"
    | None when state.Exhausted -> Error "AlreadyExhausted"
    | None when next > spec.Limit || next <> state.Failures + 1 -> Error "InvalidTransition"
    | None ->
        Ok
            { state with
                Failures = next
                Spec = Some spec
                Observed =
                    { Key = key
                      Count = next
                      Reason = reason }
                    :: state.Observed
                Exhausted = next = spec.Limit
                LastWasSuccess = false }

let private recordedApplyFailure identity spec next reason current =
    recordedAdvance
        identity
        (recordedSpecOf spec)
        (recordedInteger "consecutiveFailureCount" next)
        (text "reason" reason)
        (recordedStateOf current)
    |> recordedResult

let private recordedApplyExhausted finalCount current =
    let state = recordedStateOf current
    let finalCount = recordedInteger "finalConsecutiveFailureCount" finalCount

    match state.Spec with
    | Some spec when
        recordedSpecValid spec
        && state.Exhausted
        && finalCount = spec.Limit
        && finalCount = state.Failures
        ->
        recordedResult (Ok state)
    | _ -> rejected "InvalidTransition"

let private recordedSuccess identity current =
    let state = recordedStateOf current
    let key = dedupeKey identity

    if recordedDifferentRun identity state then
        rejected "DifferentRun"
    elif List.contains key state.SuccessKeys then
        rejected "AlreadyObserved"
    elif state.Observed |> List.exists (fun failure -> failure.Key = key) then
        rejected "ConflictingObservation"
    else
        recordedResult (
            Ok
                { state with
                    Failures = if state.Exhausted then state.Failures else 0
                    SuccessKeys = key :: state.SuccessKeys
                    LastWasSuccess = true }
        )

let private recordedCanRetry (state: RecordedState) =
    match state.Spec with
    | _ when state.Exhausted -> false
    | None -> state.Failures = 0 && List.isEmpty state.Observed
    | Some spec -> recordedSpecValid spec && spec.Limit > state.Failures

let private recordedReplay key (state: RecordedState) =
    match state.Observed with
    | latest :: _ when latest.Key = key && not state.LastWasSuccess ->
        if recordedCanRetry state then
            "RetryAuthorized"
        else
            "RetryExhausted"
    | _ -> "EpisodeSuperseded"

let private recordedObserveFailure identity reason current =
    let state = recordedStateOf current
    let key = dedupeKey identity
    let reason = text "reason" reason

    let replay outcome =
        freeze (createObj [ "ok" ==> true; "kind" ==> "Replay"; "outcome" ==> outcome ])

    match state.Observed |> List.tryFind (fun failure -> failure.Key = key) with
    | _ when recordedDifferentRun identity state -> rejected "DifferentRun"
    | _ when state.Spec |> Option.exists (recordedSpecValid >> not) -> rejected "InvalidBudget"
    | _ when
        state.Spec.IsNone
        && (state.Failures <> 0 || state.Exhausted || not (List.isEmpty state.Observed))
        ->
        rejected "InvalidBudget"
    | Some failure when failure.Reason = reason -> replay (recordedReplay key state)
    | Some _ -> rejected "ConflictingObservation"
    | None ->
        let spec = state.Spec |> Option.defaultValue { Version = 1; Limit = DefaultBudget }
        let next = state.Failures + 1

        match recordedAdvance identity spec next reason state with
        | Error "AlreadyExhausted" -> replay "RetryExhausted"
        | Error rejection -> rejected rejection
        | Ok updated ->
            freeze (
                createObj
                    [ "ok" ==> true
                      "kind" ==> "Record"
                      "budgetSpec" ==> recordedSpecView spec
                      "consecutiveFailureCount" ==> next
                      "state" ==> recordedView updated ]
            )

/// The single owner of one Logical Run's provider failure budget (vibe-fs CUT-14 ②):
/// exact attempt deduplication, single-step consecutive advance, exhaustion, success
/// reset and the answer to a replayed failure. Pure; the caller journals the facts.
[<AttachMembers>]
type ProviderFailureBudget() =
    member _.contractVersion: int = 1
    member _.defaultBudget: int = DefaultBudget
    member _.dedupeWindow: int = DedupeWindow
    member _.dedupeKey(identity: obj) : string = dedupeKey identity
    member _.forAuthority(logicalRun: obj, authorityRoot: obj) : obj = forAuthority logicalRun authorityRoot

    member _.applyFailure(identity: obj, consecutiveFailureCount: obj, current: obj) : obj =
        applyFailure identity consecutiveFailureCount current

    member _.applyExhausted(current: obj) : obj = applyExhausted current
    member _.recordSuccess(current: obj) : obj = recordSuccess current

    member _.verdict(budgetLimit: obj, consecutiveFailureCount: obj) : string =
        verdict budgetLimit consecutiveFailureCount

    member _.mayRetry(budgetLimit: obj, current: obj) : bool = mayRetry budgetLimit current
    member _.replay(budgetLimit: obj, identity: obj, current: obj) : string = replay budgetLimit identity current
    member _.recordedContractVersion: int = 1

    member _.recordedForAuthority(logicalRun: obj, authorityRoot: obj) : obj =
        recordedForAuthority logicalRun authorityRoot

    member _.recordedApplyFailure(identity: obj, spec: obj, next: obj, reason: obj, current: obj) : obj =
        recordedApplyFailure identity spec next reason current

    member _.recordedApplyExhausted(finalCount: obj, current: obj) : obj =
        recordedApplyExhausted finalCount current

    member _.recordedSuccess(identity: obj, current: obj) : obj = recordedSuccess identity current

    member _.recordedMayRetry(current: obj) : bool =
        recordedStateOf current |> recordedCanRetry

    member _.recordedObserveFailure(identity: obj, reason: obj, current: obj) : obj =
        recordedObserveFailure identity reason current
