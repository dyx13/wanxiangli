# retention

层：内核。纯计算，不读文件、时钟，不删除，不持有 Current。npm 入口 `wanxiangli/retention`。

# AXIOM

1. [使用者] writer 只能整条过期；错误类型的时刻不得让仍有读取义务的事实退出保留集合。
    - 理由：事实被当作不存在时，恢复和 Current 都会失去依据。

# LEMMA

1. [AXIOM 1] 保留单位是最近活动时刻的 UTC 日期；今天与昨天保留，前天及更早过期。同次收敛由调用方传同一个有限 now；本包不读时钟。
2. [AXIOM 1] 非有限 now 或活动时刻直接拒绝，不把 NaN 当作过期，也不让负无穷保留全部。
3. [AXIOM 1] 只有 JournalEnvelope 的可解析、有限字符串 ObservedAt 才是持久活动。数值、数组等不得经 Date.parse 隐式转换成旧日期或未来日期。
4. [AXIOM 1] 最新尾行依次判定：observed 停止；连续 ProjectionCutTail 向前；silent 或读尽则返回 null。段间遍历、扫描资源及 producer mtime 回退由主仓持有，不把旧 Journal 越过其它尾行重新当作活动。

# SPEC

1. [LEMMA 1, 2] 日界、活动推进、并集分配、对象引用与输入拒绝：`tests/011.test.mjs`。
2. [LEMMA 3, 4] 尾行分类、跨段逻辑顺序、惰性拉取及无效字段：`tests/011-tail.test.mjs`。
3. [LEMMA 1–4] 真实 tarball 在无源码及兄弟模块的消费者中通过 Node、Bun 与 TypeScript：`tests/011-package.test.mjs`。

本次接收自固定上游 202a41ab，以 40434d4 为集成基线，版本 0.9.2。

验收：Node 22.13.0 的 11 项纯规则与 3 项真实包测试全部通过；Bun 1.3.14 的同 11 项纯规则通过。实际 tarball 安装后移除其它源码与产物，Node/Bun 消费和 TypeScript 正反类型检查通过；全 20 个公开导出的实际安装消费另为 3 pass、0 fail。构建只选择 retention，原 19 份产物由同基线的宿主依赖构建结果提供，不把它们重建算成本模块证据。

首次 npm pack 因宿主默认 cache 的访问权限失败；测试改用自身临时 cache 后通过，未修改宿主目录或安装策略。主仓读盘 red 另证数值 ObservedAt 的错误裁剪与复活；JSON null 尾部在 gen98 已正确回退，不能记成本次修复。

本包不证明物理删除、断电、跨 writer 并发或远端收敛；GAP151 未闭合。日志由整合者归档，不以此处局部通过替代主仓正式 011/005/017 验收。
