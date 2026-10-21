# permit

层：账本。精确执行容量许可的唯一 owner；不得 import 宿主 SDK，不选模型、不持有容量账本、不排队、不计数。npm 入口 `wanxiangli/permit`。

# AXIOM

1. [使用者] 一次物理执行占用的容量必须在这次执行结束时、且只在这次执行结束时归还；别人的结束、迟到的回执或伪造的凭据都不能归还它。
    - 理由：提前归还会让并发超出用户在 `wanxiangshu.mjs` 设下的上限；永不归还会卡死后续执行。

# LEMMA

1. [本模块 AXIOM 1] 许可绑定精确身份（会话、物理用户消息、角色、参与者、target）与一个 credit；每个会话只有一张当前许可，新签发替代旧许可，旧许可此后一律过期。
    - 推理：按 live session 计数或“计数减一”无法区分是谁的结束（execution-model-routing [003][012]）。
2. [本模块 AXIOM 1] 只有本实例签发、仍为当前、fence 一致的许可被认得；其余按未知/错 fence/过期拒绝，不改变任何状态。
    - 推理：同形对象或旧回执不能冒充当前执行。
3. [本模块 AXIOM 1] 生命周期 Pending → Committed → Released(PhysicalCompletion)，或 Pending → Released(BeforeProvider)；有精确物理结束证据时也接受 Pending → Released(PhysicalCompletion)。两种释放互斥，同种重复幂等，已提交不能再“提供方前释放”。
    - 推理：提供方已开始的执行只能随物理完成释放，否则同一请求可被释放两次。
4. [本模块 AXIOM 1] 提交与提供方前释放要求观察到的身份与许可逐字段一致。
    - 推理：运行中追加材料或换 target 不能偷换已准入的身份。
5. [本模块 AXIOM 1] credit 接受安全正整数 number 与正 Int64 bigint，内部 credit、leaseId 与 fence 只使用精确 Int64。相同身份和等值 credit 的重入保留原许可及原字段编码；新签发按本次 credit 类型输出字段。fence 必须与原冻结许可的字段类型和值都一致。
    - 推理：宿主的 Fable int64 是 bigint；转成 Number 会拒绝或混同大于 2^53 的不同 credit。重入不能因换一种等值编码而发新身份。
6. [本模块 AXIOM 1] 签发计数只有一个 owner。计数到 Int64 上限，或新的 number 许可身份将超过 MAX_SAFE_INTEGER 时，在任何状态变化前拒绝；无 seed 或计数器测试后门。
    - 推理：溢出、回卷和有损表示会让旧围栏与新围栏混同；失败签发不能消耗身份或替换当前许可。

# SPEC

1. [LEMMA 1] 重复签发同身份同 credit 交还原许可；身份或 credit 变化签发新许可，旧许可 StaleFence。
    - 证明：`tests/001.test.mjs`。
2. [LEMMA 2] null、伪造、他实例签发、过期、fence 不符的许可被拒绝且不改状态。
    - 证明：`tests/001.test.mjs`。
3. [LEMMA 3] 全部状态 × 证据的迁移表；物理释放只认当前许可的物理消息。
    - 证明：`tests/001.test.mjs`。
4. [LEMMA 4] 会话、物理消息、角色、参与者、target 不符依次给出拒绝。
    - 证明：`tests/001.test.mjs`。
5. [LEMMA 5, 6] 大于 2^53 的相邻 bigint credit、Int64 最大合法 credit 与越界拒绝、跨编码重入、严格 fence 编码、无效 number 不留痕、伪造及旧物理回执、终态互斥。
    - 证明：`tests/002.test.mjs`；Node 22 与 Bun 各 15 项通过（含原测试）。计数上限由签发前 guard 静态核对，未执行 9e15 次签发，不把最大 credit 测试称为计数耗尽实测。公开 tarball/TS 消费等待真实 export 接入后验收。
