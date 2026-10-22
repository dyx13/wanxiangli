# failure-budget

层：内核。不得 import 任何宿主 SDK。一个 Logical Run 的 provider 失败预算的唯一 owner（vibe-fs CUT-14 ②）：精确 attempt 去重、连续失败计数单步推进、耗尽、成功清零、重放失败的回答。纯计算，不写日志、不发请求。npm 入口 `wanxiangli/failure-budget`（`ProviderFailureBudget`）。

# AXIOM

1. [使用者] 每一次自动重试都是一次真实请求，可能真的再花一份钱；自动重试必须有上限。
    - 理由：真实外部效果不可逆（总规则 LEMMA 1）。

2. [使用者] 同一次失败可能被观察到多次（重放、恢复、并发回调）。
    - 理由：日志与回调可以重复送达。

# LEMMA

1. [本模块 AXIOM 1, 2] 计数只认"新的精确 attempt"：同一个 (session, logical run, authority root, provider run) 只记一次。
    - 推理：重复观察若再计数，预算会被同一次失败耗尽；不计数才和世界上真实发生的请求数一致。
    - 实现：`applyFailure` 对窗口内已有的键给 AlreadyObserved；窗口 32，最新在前。

2. [本模块 AXIOM 1] 连续计数只能从折叠状态单步推进，耗尽是这一 run 的终态。
    - 推理：跳号或回退说明记录与世界不一致；耗尽后再推进等于绕过上限。
    - 实现：记录的计数必须等于当前计数 + 1，否则 InvalidTransition；`exhausted` 后一律 AlreadyExhausted；别的 run / authority root 给 DifferentRun。

3. [本模块 AXIOM 1, 2] 已记过的失败从记录回答，不再计数：只有最新的那一次 attempt 还可能被授权重试。
    - 推理：较早的 attempt 已被后来的 attempt 取代，再授权会重复发送。
    - 实现：`replay`：最新键 = 该键 → 预算余量决定 RetryAuthorized / RetryExhausted；否则 EpisodeSuperseded。

4. [本模块 AXIOM 1, 2；vibe-fs provider-attempt-recovery WHAT 001/003/005] 持久化预算的身份保留整个 Logical Run，首条失败提交预算版本与上限，后续失败不能换上限；同身份的 count、reason 或 spec 冲突必须拒绝。成功只清连续计数，旧成功不能清除新失败；达到上限的那条失败立即耗尽，迟到成功不能重开。
    - 实现：`recorded*` 消息处理显式的完整记录状态，`recordedObserveFailure` 同时决定新记录与重放回答。旧窗口 API 保留其公开合同，不被猜测成完整持久化记录。

# SPEC

1. [本模块 LEMMA 1] 去重键逐字节与 vibe-fs 宿主历史键一致，同一 attempt 第二次观察不推进。
    - 证明：`tests/001.test.mjs` SPEC[failure-budget-1]。
2. [本模块 LEMMA 2] 单步推进、耗尽终态、成功清零、畸形输入拒绝。
    - 证明：`tests/001.test.mjs` SPEC[failure-budget-2]、SPEC[failure-budget-4]。
3. [本模块 LEMMA 3] 重放只授权最新 attempt。
    - 证明：`tests/001.test.mjs` SPEC[failure-budget-3]。
4. [本模块 LEMMA 4] 60 次成功重置仍保留全部失败与成功身份，冲突计数、原因、预算和跨 root 拒绝；旧成功与缺失耗尽确认不能重新开放预算。调用方只映射结果与写事实。
    - 证明：`tests/002.test.mjs` SPEC[failure-budget-5] 至 SPEC[failure-budget-10]，Node22 全库与 Bun 本模块均已通过；实际包外 Node/Bun 消费通过。主仓 provider-attempt-recovery-003 仍需正式验收，不以库证明代替宿主持久化接线。

# TODO

- 上限数值 12 是 vibe-fs 现行契约，照旧作为 `defaultBudget` 给出；调用方仍可传入别的上限。
- 失败事实的日志写入与折叠调度留在宿主；本包只回答"这条记录能不能推进、推进成什么"。
