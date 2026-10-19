# SM-02B 新模块接收证据

2026-10-19，输入SM-02A提交152719c，macOS、Node26.6.0、Bun1.3.14。候选0.8.1扩为十六入口：Time纯Deadline、NodeTime物理时基、TimeTesting验证时基分别独立编译与打包；只共用纯接口Temporal.fs。

## 修改及反例

- resources先裁剪模板再替换；BOM、CRLF、注入值首尾空白及尾换行保持原字。002新增双语反例在旧产物失败。
- wait移除生产导出写入deadline.cancelCount；冻结句柄的信号胜出和即时读取两例先红。取消计数由测试闭包持有。等待只消费observer capability，不要求完整registry。
- 时间三种职责分居；纯入口不再携带物理/虚拟工厂，移走其源码和产物后仍实际编译及消费。UtcNow声明改为Date；缺失now输入显式拒绝，不借Fable解析器读取当前时刻。
- WaitLease声明如实表达函数式消费；补齐CompletionMailbox.waitForSignal及pendingAgentWakeCount；公开escape词汇封闭。真实strict TypeScript正反例与Node/Bun消费者共同验证。
- GAP-085完整自子树判断移入fs共享glob内核并由grounding消费；未来未创建路径、include/exclude、字符类及不相交正控已验。保留原字符类首个右括号修复，不用现存文件枚举代替整个子树。
- 既有fs边界在macOS逻辑根/realpath别名下误拒绝，Node/Bun各两例红。实际比较确认同一根规范化后可读，修正比较的根并以规范相对路径构造listing；新增根本身是symlink的正反边界。

## 验收

| 范围 | 结果 |
|---|---|
| Node的resources/time/wait/fs/grounding/identity/events套件 | 191pass，0fail/skip/TODO |
| Bun同一七模块集合 | 191pass，0fail |
| 时间三单元及原有核心的独立编译，真实时间等待安装包 | 20pass，0fail/skip/TODO |
| 停止构建后重新打包的strict TS、Node/Bun消费及删除虚拟/物理产物证明 | 3pass，0fail/skip/TODO；同一父测试还执行两运行时移除后的生产和纯计算消费 |

命令为 `node --test src/resources/tests/*.test.mjs src/time/tests/*.test.mjs src/wait/tests/*.test.mjs src/fs/tests/*.test.mjs src/grounding/tests/*.test.mjs src/identity/tests/*.test.mjs src/events/tests/*.test.mjs`，Bun使用同目录的`bun test`；独立构建及交付入口为 `node --test scripts/tests/time-wait-package.test.mjs scripts/tests/build.test.mjs`。最终静止候选再单跑time-wait-package。

原始红绿日志保留在本目录。早期time/wait产物扫描把esbuild来源注释中的邻仓名字误当npm import，已改成检查实际import语法；它不是产品依赖缺陷。原new Date文本扫描也不能区分Fable解析辅助函数与实际时钟读取，改用拦截零参数Date构造的行为反例，并校验缺失输入被拒绝，未删除纯计算保证。

## 剩余

SM-02C仍需全库固定候选及全部导出闭包验收、发布可取得SHA。上游禁止一切tgz的索引测试与本地15份历史取证归档冲突，须明确“运行依赖归档退出、原始证据保持”的责任边界；不删除或改名掩盖旧红证据。主仓真实接线、原算法退出、Host定时器/Join及GAP-085实际插件仍归后续工作包。本批未做非作者复审、registry发布或Host部署。
