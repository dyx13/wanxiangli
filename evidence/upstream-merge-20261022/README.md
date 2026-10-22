# M22-2 库合并验收

输入为自有 `45849f51778f6a12dcafbc12ce1c8c7f7f65502b`、上游 `663ba59b8282db5e3eeccda0c1100ea8cdca0dd0`，共同祖先 `a8b89a45607572a62e1ca085c907fb02c878e6c0`。39 个冲突逐项手工消解，候选 0.66.1 保留 55 个公开入口。版本、产物摘要、命令和测试计数见[收据](receipt.json)。

## 自有修复的去向

- permit 继续使用精确 Int64、严格 fence 编码、跨 number/bigint 等值重入与签发前边界拒绝。
- prefix 继续支持规范十进制 string epoch，内核 bigint，拒绝混合编码和不安全数字后继；compression 的最大锚点区间末端、第一拒绝原因与不可释放的终局失败准入保留。
- delivery 的 seal/restore、exact provider/call、封存材料和 keys、peek 不消费以及冷恢复不补造 keys 保留。
- retention 的 UTC 日期和非字符串 ObservedAt 拒绝、Casebook 的代理对边界及已知碰撞反例保留。
- process/supervision/native-process 的 wire、compiled Bun Worker、输入与 EOF 次序、输出 extent、背压和真实收尾未改；time/time-node/time-testing、resources、wait 的生产实现亦未改。
- 构建接收逐模块缓存，保留共享 `BunProcess.fs` 和 `Temporal.fs` 的精确路径许可及拒绝越界反例。原证据归档的固定清单、原名原字节保留，发行包不含证据归档。

## 红例与修正

1. 首次 Node22 模块测试 910 项中 902 pass、2 fail、6 skip。PTY 的 non-directory 夹具在 macOS 因 `/etc/hostname` 不存在得到 ENOENT；改为创建真实临时普通文件，继续要求 ENOTDIR 和零 driver 调用。retention 安装包断言仍写 0.9.2，改为要求包版本等于当前 manifest。
2. 首次隔离构建 46 项中 45 pass、1 fail。delivery 的四处隐式 obj 推断触发原无 warning 断言；增加精确类型标注，原断言不变，单项及完整复跑通过。
3. 全导出包测试原冻结清单为 22 入口，按本批 55 个完整范围更新。首次列表排序把 degeneration/delegate-batch 写反，红例保留，修正排序后通过。最终补验全部实际安装的公开声明可同时通过严格 TypeScript 检查。

## 已得证据与边界

Node22 模块全集 912 项，906 pass、0 fail、6 skip；scripts 全集 87 项，86 pass、0 fail、1 Linux 限定 skip；没有取消或 TODO。Bun 保留纯合同 120/0。55 个入口及类型真实打包、安装到仓外目录，Node/Bun 全部导入且产物字节一致；安装目录没有源码、证据归档或编译器依赖。

首次完整 Fable 构建 55 模块全部成功，但记录了 203 条 warning；delivery 的四条已随类型标注消除。其它模块的 warning 不在本次扩大修复范围，不能宣称完整库零 warning。最终构建命中 55 模块缓存，逐文件输出摘要仍匹配；必要的独立编译由正式隔离构建套件证明。

原始日志保留在 `/private/tmp/vibe-fs-upstream-plan-20261022/`，其摘要记在收据中。旧原生长测时长不计入本候选；本次库验收不证明主仓接线、第二宿主、断电、部署或全部历史 GAP 闭合。
