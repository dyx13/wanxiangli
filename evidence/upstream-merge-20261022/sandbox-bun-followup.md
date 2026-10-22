# Sandbox 双运行时复核

本记录覆盖 c1aa9af 之后的膜与暂停结算修复，不沿用首轮库成绩证明新源码。

实际运行器为 Node 22.13.0 和 Bun 1.3.14。先按每个测试文件独立 Bun 进程执行，避免 Bun 的 node:test 跨文件注册错误遮住产品失败。原完整命令日志为 `/private/tmp/m22-library-final-bun-affected.log`；隔离日志为 `/private/tmp/m22-library-bun-src-*.log`。

## 原始失败与归因

| 行为 | 固定上游 663ba59 | 本地旧主仓 HEAD | 本次修复与结果 |
| --- | --- | --- | --- |
| Bun globalThis constructor / 显式 prototype constructor 可读宿主 process | 同源复现，原有漏洞 | 库 45849f5 没有 sandbox 模块，不能伪造库基线；旧宿主裸 vm 不作为安全方案 | 捕获 Object 后仅切 globalThis 原型为 null；保留膜、类桥与原反例，两运行时拒绝这些链。 |
| paused 期间已结算宿主 Promise 提前推进、碰到 parked guard | 上游尚无 pause API | 旧宿主 park 由未结算 deferred 承担，不具此新句柄 API | 每 invocation 暂存结算，resume 一次交付，终态清队列，迟到与重复回调不复活调用；两运行时对应反例通过。 |
| post-await 无限循环不受 VM timeout 控制 | Bun 子进程在父级 5 秒期限被回收；Node 22 在自身 VM 期限拒绝 | Bun 与 Node 旧裸 vm 均在父级 5 秒期限被回收 | 未扩大成新执行架构。Bun 原有机制 P1 保留，002/006 原用例仍失败，未改 skip、断言或预算。 |

同源探针只读提取不可变提交或主仓 HEAD 的原始膜/launch/wrap 字符串，在临时进程执行，未用探针替换生产代码：

- `/private/tmp/m22-sandbox-realm-probe.mjs`，两运行时日志 `/private/tmp/m22-sandbox-realm-probe-{bun,node22}.log`。
- `/private/tmp/m22-vm-microtask-probe.mjs`：同一 afterEvaluate 微任务 marker 的同步观测，Bun 为 0、下一 host 回合为 1；Node 两次均为 1。
- `/private/tmp/m22-sandbox-baseline-probe.mjs` 与 `/private/tmp/m22-sandbox-baseline-probe.log`：post-await 无限循环的旧存归因。

## 修复后的实际产物

独立 sandbox 模块构建命令为 `node scripts/build.mjs sandbox`。已确认 dist 含原型切断、pendingSettlements 和终态 close，随后运行：

- Node 22 全部 sandbox 测试：23 pass、0 fail、0 skip，日志 `/private/tmp/m22-library-sandbox-hardening-node.log`。
- Bun 逐文件 sandbox：21 pass、2 fail。001/003/004/005 全绿，006 为 6 pass/1 fail，002 为 1 pass/1 fail；仅上述 post-await 硬期限失败。日志 `/private/tmp/m22-library-bun-hardened-*.log`。
- Bun delivery 六文件 29 pass，programming 7 pass；加 sandbox 合计 57 pass、2 fail。delivery/programming 源未因本次 sandbox 修复改动，原隔离日志仍绑定其实际产物。

未运行真实 omp，也未据库纯测试宣称主仓 Bun 基本编程或真实 park 全链通过。主仓正式验收另记。膜外调用模型回调的 MF01 硬期限 P1 仍未闭合。

## 最终库与包外复验

当前新源码的 Node 22 完整 `npm test` 实际 exit 0：1013 tests，1006 pass、0 fail、7 skip、0 todo，64.39 秒。日志 `/private/tmp/m22-library-final-npm-test-after-sandbox.log`，不沿用修复前的 1004 pass。

真实 tarball 为 `/private/tmp/m22-library-final-package/wanxiangli-0.66.1.tgz`，SHA256 `8fe5176efed627b1069ab10429896143441299739c82fd20eb84be95d6d521cb`。包外消费者在 `/private/tmp/m22-library-final-package/consumer` 真实安装该包，执行文件仅从公开 `wanxiangli/sandbox` 导入，清除 NODE_PATH/NODE_OPTIONS，并从 `/private/tmp` 运行。Node 22 与 Bun 均 exit 0，验证继承数据、getter 和接收者、toJSON 不激活、全局原型逃逸拒绝、跨旧期限 pause／新期限 resume，以及 timeout 后晚结算不能复活。installed Sandbox.js 与当前 dist 字节一致。日志为同目录的 `node22-consumer.log`、`bun-consumer.log`，执行载体 `consumer/verify.mjs`。

上述包外定向通过不覆盖 post-await 无限循环。Bun 两项既有硬期限失败继续单列，不将其改为 TODO 或 skip。

## 宿主预算错误字段的最终修复

主仓 Process015 的真实调用发现新增接线退化：膜复制宿主 `__jsFailure` 时丢掉 `minimumOutputBudgetBytes`，使原来的 `CALL_OUTPUT_BUDGET_TOO_SMALL` 变成 `PROGRAM_FAILED`。现在仅在该字段为正的安全整数时复制，并在模型运行前捕获内建判定；不转换字符串、bigint 或对象，不暴露宿主失败对象。003 的两个新增反例同时验证正常字段、模型改写内建、constructor 逃逸拒绝、非法值和无对象强转。

此修复后的 Node 22 完整 `npm test` 实际 exit 0：1015 tests、1008 pass、0 fail、7 skip、0 todo。日志 `/private/tmp/m22-library-final-npm-test-budget-fix.log`，SHA256 `960ef53bdd0890779e256579d7248c4dd080d87ad47377a1c1ce38944d5d66ed`。sandbox 共 25 项通过。Bun 逐文件重跑全部 delivery、programming、sandbox：59 pass、2 fail，仍仅上述 002/006 的既有 post-await 硬期限 P1；日志 `/private/tmp/m22-library-final-bun-budget-summary.log` 与同前缀的分文件日志。

最终新包为 `/private/tmp/m22-library-final-budget-package/wanxiangli-0.66.1.tgz`，SHA256 `8b7e8d7c26875a5c0b8b9289f00ec03221ff1782c01f5e5085ab975ce35a56e9`。同目录 `consumer` 真实安装该 tarball，只从公开入口导入；Node 22 与 Bun 的包外消费均 exit 0，新增安全预算失败字段与原类/getter/toJSON、原型拒绝、暂停/恢复和晚结算反例一并验证。对应 `node22-consumer.log`、`bun-consumer.log`，installed Sandbox.js 与本次 dist 逐字节一致。之前的 8fe5176e 包仅代表上一子批，不能代证本节新源码。

## 未捕获错误 sentinel 的最终闭环

进一步用主仓真实 `this.call` 拒绝探针检查，发现前一子批仅证明模型 `catch` 内字段已保留，膜的外层 `__jsHostFailed` JSON 编码又丢了一次该字段。现仅在该编码中携带同一已安全复制的字段；003 增加未捕获宿主拒绝的正值和非法值反例。主仓无物理命令效果的诊断已从 `PROGRAM_FAILED` 恢复为 `CALL_OUTPUT_BUDGET_TOO_SMALL`、minimum 603，日志 `/private/tmp/m22-process-minimum-refusal-sentinel-fixed.log`。这不是对新主仓构建的正式 requirement 验收，正式结果另记。

最终源码的 Node 22 完整 `npm test` 实际 exit 0：1016 tests、1009 pass、0 fail、7 skip、0 todo，sandbox 26 项通过。日志 `/private/tmp/m22-library-final-npm-test-sentinel-fix.log`，SHA256 `d56578bf952519f184dd214ba486927fd7b569c459f1a6e954a84b4cb328a89c`。Bun 所有受影响模块逐文件重跑为 60 pass、2 fail，仍仅原 002/006 的 post-await 硬期限 P1；日志 `/private/tmp/m22-library-final-bun-sentinel-summary.log` 和对应分文件日志，未改断言、skip 或预算。

最终交付候选包为 `/private/tmp/m22-library-final-sentinel-package/wanxiangli-0.66.1.tgz`，SHA256 `84293b2270d873975ac344a7a325bd328606f134e49d9564ed1747926b3024dc`。同目录新 `consumer` 真实安装并仅消费公开入口，Node 22 与 Bun 均 exit 0，覆盖 catch 内与未捕获 sentinel 的安全 minimum、非法值、不暴露宿主对象、类/getter/toJSON、全局逃逸拒绝、跨期限 park/resume 和晚结算不能复活。两份消费者日志 SHA256 均为 `cf3b86cfb88db7062be968f5eab499a87b59cbfd07af55172df4bca861cb2578`，installed Sandbox.js 与当前 dist 字节一致。上节 8b7e8d7c 包与全部更早包均只是子批证据，不能代证本节源码。
