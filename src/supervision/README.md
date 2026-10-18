# SupervisedProcess

`import { SupervisedProcess } from 'wanxiangli/supervision'`。

构造参数与 `wanxiangli/process` 的 `ProcessOptions` 相同，每次构造启动一次目标，不重试。此对象始终使用 Capture；`tailBytes` 只限制 `read` 的尾部视图，不限制完整 `takeOutput`。

此组合增加一个真实组长。目标进程与仍在同组的后代受这个组长监管，组长自身通过基础 ProcessSession 持有。目标退出后仍有后代持输出管道时，组长继续存活，`signal` 仍可发给这一次执行。自然完成也在保留组长身份时清组。

调用顺序：

1. 等 `started()`。Started 的 PID 属于目标；Failed 不表示确定“目标从未执行”，须保留错误码。启动失败会自行清理本实例，不要求调用方另开输出消费者。
2. Started后持续调用单消费者`takeOutput()`，处理双路`Chunk`。每块至多64KiB；游标按各路实际字节增加。Node使用原生pipe，Bun使用私有FIFO，Worker出口等待每块实际写入与flush，外侧暂停能向目标传递背压。Bun读端每路Readable队列最多128KiB、另有64KiB scratch；这不等于总RSS上限。
3. 按需要 `write`、`endInput` 或 `signal`。Written 只确认写入组长的转发输入管道，不确认目标收到或消费。信号 Requested 只确认发出请求；目标 exit 及输出收尾是后续事实。
4. Capture 返回 Closed 时也必须检查 `state.failure`。`wait` 只有在真实组长 close 与 Capture EOF 或显式丢弃都完成后才返回 Closed。调用方不得停止消费后只等待，否则背压可让目标无法结束。
5. 若落盘或调用方消费失败，明确 `signal('SIGKILL')`、`discardOutput()`，再等待收尾；丢弃不能算完整材料。等待超时本身不发送信号。

Worker逐块等目标写回执，最后才结束输入，避免背压时EOF越过尚未写入的块。目标提前关闭输入会结束转发，仍继续收取输出与原生终结；真正的source读取故障另行报告。不销毁借用的stdin，不重发失败写入。Written的第一跳确认范围不变。

状态字段的归属：

| 字段 | 事实 |
| --- | --- |
| `pid` / `exit` | 目标 spawn / exit；不使用组长退出码补齐 |
| `supervisor` | 组长的 PID、阶段、退出与基础会话错误 |
| `stdin` / Written | 组长转发输入管道 |
| `stdout` / `stderr` | 已经由 Capture 交付的字节及可查询的尾部留存量 |
| `capture` | Open、Closed、Failed 或 Discarded |
| `failure` | 第一个监管、控制或输出失败；即使另有目标 exit，也须处理 |

目标close且两路计数流readable end后，组长发布不可变逐路最终extent。外侧实际Capture observed恰好收齐，才用仍存活的组长身份发KILL，随后确认底层close和Capture EOF。零字节回调不再作为Bun排空证明；EOF不足报告OUTPUT_INCOMPLETE，超数报告OUTPUT_COUNT_MISMATCH，主动KILL导致不足报告OUTPUT_INTERRUPTED。自然完成的`supervisor.exit.signal`通常是SIGKILL，目标`exit`保持真实状态。缺失或畸形extent明确失败，不猜零，不重发目标。

`UNKNOWN_TARGET_START` 表示没有目标启动回执；`UNKNOWN_TARGET_EXIT` 表示监管器已结束但没有目标退出回执。两者都不能自动重试或补 exit 0。组长意外单独死亡时，目标可能仍活；此时 Closed 只证明本对象的组长和转发管道已关闭，不能据此结算目标资源已物理结束，也不再对旧组长 PID 发信号。

这是 POSIX pipe 能力，不是 PTY 或安全沙箱。不追踪脱离进程组的后代，不支持宿主崩溃后接管、重开控制目录或证明任意进程树已结束。实例控制目录权限为 0700，事实文件为 0600，目录不传给目标；这不防御同 UID 恶意进程枚举和篡改。目标正常结束时仍在同组且已经关闭输出的后代，会一并清理。

实现为本模块F#编译后的同一个已交付bundle。只有bundle本身作为带内部参数的入口执行时才启动组长，正常import没有启动副作用。不查找源码或未交付worker。Bun除原生模块与process公开产物，还显式需要可执行的`/usr/bin/mkfifo`及支持FIFO的临时文件系统；准备失败不回退旧管道。失败后也必须检查清理错误，不能仅凭Closed宣称描述符已释放。
