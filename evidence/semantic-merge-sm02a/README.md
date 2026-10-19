# SM-02A 核心库整合证据

2026-10-19，macOS，固定本地 8bb1021 与上游 71c155f。候选 0.8.1，十四个公开入口；本地 Process、Supervision、Trace、Journal、Ownership 和组合生产源码未被上游改写，上游 Work 的新增规则已接入。五个文本冲突由手工处理；manifest 保留监督增强入口、类型、说明和测试。

| 验证 | 命令与结果 | 范围 |
|---|---|---|
| 全库 Fable 构建 | `node scripts/build.mjs`，exit 0，十四模块生成 | 新增 wait 等上游源码有既存 F# 推断 obj 警告；构建成功不代证新增模块接收 |
| Node 核心七职责 | `node --test src/lifecycle/tests/*.test.mjs src/eventstore/tests/*.test.mjs src/assembly/tests/*.test.mjs src/process/tests/*.test.mjs src/supervision/tests/*.test.mjs src/trace/tests/*.test.mjs src/session/tests/*.test.mjs`，321 项、315 pass、0 fail、6 skip、0 TODO | Work 新门、Journal 真实 SQLite、完整输出/监管、Trace 原件和 Ownership |
| Bun 核心五职责 | `bun test src/lifecycle/tests src/process/tests src/supervision/tests src/trace/tests src/session/tests`，273 pass、0 fail | 真实 Bun 环境、输入排空、背压、原件和领域规则 |
| 独立编译与包外组合 | `node --test scripts/tests/build.test.mjs scripts/tests/contracts.test.mjs scripts/tests/package.test.mjs scripts/tests/trace-package.test.mjs scripts/tests/supervision-package.test.mjs scripts/tests/ownership-composition.test.mjs scripts/tests/ownership-package.test.mjs`，43 pass、0 fail/skip/TODO | 真实 npm 安装、Node/Bun SQLite 强杀恢复、监管移除后基础 Process 仍可用、无兄弟源独立编译 |

首轮 Bun 错误地纳入静态导入 `node:sqlite` 的 eventstore/assembly Node 专用测试，得到 273 pass、6 加载错误、exit 1。原日志保留为 `wanxiangli-sm02a-bun.log`；没有改测试或把产品失败变 skip。Bun 的 Journal/assembly 真实消费由 Node 驱动的安装包测试单独验证，正确范围的 Bun 核心调用通过。

所有原始命令输出与本文件同目录。构建使用工作树显式声明的 devDependencies；安装包用真实 pack 安装，未把源码链接作为发行证明。无 registry 发布或主仓 Host 部署。

剩余：SM-02B resources/time/wait/grounding 接收反例、新模块独立消费；SM-02C 最终库候选与全部声明闭包；主仓新工具、状态根和授权接线。以上局部通过不关闭原抽吸父卡或 GAP，不代表非作者复审完成。
