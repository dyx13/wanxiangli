# supervision — 保留组长身份的真实进程监管

入口 `wanxiangli/supervision`，对象 `SupervisedProcess`。这是依赖 `wanxiangli/process` 交付产物的显式组合；独立 F# 工程不读取或编译 process 源码，不依赖宿主、Work、Journal 或 Ownership。

这里的process源码指ProcessSession、OutputTail及其领域适配。两工程明确共享唯一私有`src/native-process/BunProcess.fs`原生I/O实现，不编译对方的会话或监管状态；构建门禁只允许该确切路径。该适配拥有单个child的I/O事件状态，透传detached策略，不裁决目标业务完成。Worker以detached:false调用；同步spawn异常发布确切failed/spawn，不能退成worker Unknown。

## AXIOM

1. [使用者] 目标命令退出后，同组后代仍可能持有输出管道；取消仍须作用于这一次执行，不能使用已失效的进程组身份。
   - 理由：仅等待直接目标退出会遗漏后代；重用旧 PID 又可能伤及别的执行。
2. [使用者] 完整输出与目标退出是分别观察的事实；监管器结束不能冒充目标成功。
   - 理由：过早清组会丢末尾输出，控制通道丢失则不能猜出没有观察到的目标状态。

## LEMMA

1. [AXIOM 1; 根 LEMMA 4, 6] 外侧使用 Capture 模式的 ProcessSession 启动真正组长；组长在自己的组内以 `detached:false` 启动目标。组长忽略 TERM、INT、HUP，直到外侧显式清组。
   - 推理：目标 exit 不结束组长身份，仍可遵守基础 ProcessSession 仅对尚未观察到退出的直接子进程发组信号的规则。
2. [AXIOM 2; 根 LEMMA 3, 4] 组长用原生pipe转发双路输出，逐路计数；目标close且两路计数Transform的readable end后，发布不可变最终extent。外侧实际Capture observed逐路恰等于extent，才允许自然KILL组长，并继续等待ProcessSession close与Capture EOF。零字节写回调不能证明Bun缓冲已排空。
   - 未闭合边界：Bun1.3.14原生pipe会提前缓存输出，现有逐块交接不能证明实际背压或总内存界限；该义务仍待实现，不因完整字节转发通过而关闭。
   - 推理：Worker已交给兼容写出队列，不等于外侧已收到；将确切两路extent与本次实例实际观察仲裁，才能避免清组截断尚在Worker中的字节。EOF缺数或超数明确失败；主动KILL引起的缺数单列OUTPUT_INTERRUPTED，不能冒称完整输出，也不覆盖宿主既有取消/超时结果。
3. [AXIOM 1, 2] 每个实例使用私有目录与原子文件传递启动、退出及关闭事实。目标参数、环境不包含控制路径；公共返回值不暴露目录或原生句柄。控制失败不重试启动，也不补目标退出码。
   - 推理：实例内的事实关联不能依赖共享目录中的固定公开名称。这里的私有是实例隔离，不是防御同 UID 恶意进程的安全沙箱。
4. [AXIOM 2; 根 LEMMA 7] 这是新增监管契约，不是完全透明的 ProcessSession 替身。`pid`、`exit` 属于目标，`supervisor` 属于组长，`stdin` 与 `write` 回执属于组长转发管道。未知退出保留 `exit:null` 和明确失败。
   - 推理：增加实际转发进程改变了输入确认的物理边界；类型相似不能抹掉这一差别。组长意外单独死亡后不再拥有安全组信号许可。

## SPEC

1. [LEMMA 1, 3, 4] 先验证目标输入；Started 只由目标 spawn 事实产生。启动失败自动清本实例，不要求失败调用方继续消费输出。
   - 证明：`tests/001.test.mjs` 验证非法输入、访问器、显式 argv/env/cwd、目标 ENOENT、无消费者启动失败的目录与计时器清理、真实二进制输入及快照副本。
2. [LEMMA 2] 正常完成保留全部原始双路输出，慢消费者只施加背压，不以尾部查询代替完整采集。
   - 证明：`tests/002.test.mjs` 双路各 8 MiB 加二进制尾部、先暂停读取、连续游标、零 tail 容量及目标 exit 0 后清组。
3. [LEMMA 1, 2] 目标先退出但后代持管道时仍能 TERM→KILL；目标自然 close 后，清理仍在同组但已关输出的后代。
   - 证明：`tests/003.test.mjs` 使用真实后代就绪 IPC 屏障，确认目标 exit 23、后代 TERM 回执、等待超时、KILL 后同组后代消失；另验证未继承输出但仍存活后代的自然收组。
4. [LEMMA 3, 4] 组长意外退出、控制目录丢失、退出事实写入失败都不能成为目标 exit 0。
   - 证明：`tests/004.test.mjs` 真实杀组长、删除本实例控制目录、阻断 `exit.pending` 写入。后者由仍存活组长立即杀自己的组；无法发出的目标事实保持未知。
5. [LEMMA 1, 3] 实例、等待、输出隔离，公开对象不泄露原生控制权。
   - 证明：`tests/005.test.mjs` 两个真实组同时运行，终止第一个不改变第二个；两个等待独立结束，公开字段只有声明消息。

## 验证及边界

- 构建：`node scripts/build.mjs process supervision`。只构建本模块时用 `node scripts/build.mjs supervision`，运行时仍需已交付的 process 入口。
- Node 验证：`node --test src/supervision/tests/*.test.mjs`。2026-10-15，macOS，Node 26.6.0，12/12 通过。
- Bun 验证按文件执行：`bun test src/supervision/tests/001.test.mjs` 至 `005.test.mjs`。2026-10-15，macOS，Bun 1.3.14，12/12 通过；大输出反例同时检验基础 Capture 在空缓冲上推进真实 EOF。
- 不支持 PTY、Windows、逃逸到其他进程组的后代、父宿主崩溃后接管、重新打开控制目录或全树终止证明。正常清组包含仍在同组且已关管道的后代，但不会发现脱组守护进程。
- `Closed` 表示组长及本对象管道已关闭，Capture 已结束或显式丢弃。若带 `UNKNOWN_TARGET_EXIT`，目标可能仍活，不能据此结算目标资源已物理结束；也不能对旧组长 PID 继续发信号。
- 只有无失败且 Capture EOF 的自然完成证明完整输出；显式 `discardOutput`、强杀中的未转发字节、失败启动时的自动丢弃均不冒称完整材料。`write` 成功仅确认写入组长输入管道，不确认目标收到或处理输入。
- 此模块不保存工作归属或持久日志。主仓接线、npm 导出、安装包验收与各目标平台验证由外层工作包单独记录。
