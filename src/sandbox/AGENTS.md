# sandbox — 受限 JS 执行膜

层：内核。npm 入口 `wanxiangli/sandbox`，导出工厂 `Sandbox()`。不得 import 宿主 SDK；不持有跨调用状态；不读文件或环境变量。

来源：宿主仓 `proposals/extraction-kanban/cards/CUT-25.md`；现行需求 `requirements/repository-programming/WHAT.md` [006]。能力投影、基类生成、park/unpark 产品协议、JsFailure 解码留在宿主组合者。

# AXIOM

1. [使用者] 模型程序不得获得文件系统、网络、进程或环境变量。
    - 理由：repository-programming [006]；node:vm 文档明确不是安全机制，必须自行切断宿主 realm 可达路径。
2. [使用者] 执行有硬性超时；超时后终止并清理。
    - 理由：同 [006]；`runInContext` 的 timeout 只覆盖同步段，await 之后的死循环要靠 afterEvaluate 驱动排水。

# LEMMA

1. [AXIOM 1] 上下文用 `DONT_CONTEXTIFY` 创建；捕获 realm 的 Object 后把 globalThis 的原型切为 null，拒绝 Bun 全局原型的宿主 constructor 链。宿主对象不挂到全局；凡进入程序的宿主值（返回值、Error、Promise、函数、Callable 实例）都复制或包装成 sandbox-realm 值。
2. [AXIOM 1] membrane 与模型程序同 realm：membrane 用到的内建方法（WeakMap/Reflect/数组拷贝）在模型代码运行前捕获引用，经捕获的 Reflect.apply 调用；模型改写原型不影响 membrane。
3. [AXIOM 1] 期限检查用宿主时钟，不读可被程序改写的 sandbox `Date.now`。
4. [AXIOM 2] 宿主侧驱动循环在每次 `runInContext('void 0')` 上施加剩余 timeout，使 await 之后的同步死循环同样以超时结束。
5. [AXIOM 2] 驱动循环按唤醒推进，不空转：程序等待的宿主 Promise 用宿主 realm 的回调订阅（落在宿主微任务队列），结算或宿主回调进程序代码时唤醒驱动；两次唤醒之间睡到期限或慢轮询（unref 定时器）。空闲程序（park、等宿主 Promise）不占 CPU，也不单独让进程存活；期限过后在进程存活期间仍以超时结束。
6. [AXIOM 2] 仅宿主句柄可暂停驱动。暂停不延长期限，不排水模型微任务，也不允许模型调用宿主能力；宿主 Promise 在暂停中结算时，其唯一 continuation 留在本次调用的宿主队列，恢复后才交付。调用终态清理队列并拒绝迟到结算，不由再次 resume 复活。恢复后仍使用当前真实期限。产品组合者在续接或清理前重置期限，park/unpark 协议仍归宿主所有。

# SPEC

1. [LEMMA 1] 下列逃逸在 membrane 下均拿不到宿主 `process`，且不能在 workspace 外写文件；在 naive 实现上会成功（base-red）。
    - 全局 `api` / `__deadlineRef` / `globalThis.constructor` / `this.ls` 返回值的 `constructor.constructor`
    - 证明：`tests/001.test.mjs`
2. [LEMMA 4] 同步死循环与 await 之后的死循环都在 deadlineMs 量级内以超时结束。
    - 证明：`tests/002.test.mjs`（await 路径在子进程中跑，避免 node:test async_hooks 与 afterEvaluate 冲突）
3. 正常 api 往返仍返回 sandbox 数据（例如 `ls` 的 entries 数组）。
    - 证明：`tests/001.test.mjs` normal ls
4. [LEMMA 2] 模型改写 `WeakMap.prototype.has` / `.set` 不能观察到 membrane 传入的宿主值（0.23.1 上会泄漏宿主对象并拿到 `process`）。
    - 证明：`tests/003.test.mjs`
5. [LEMMA 5] 等一个不结算的宿主 Promise 的程序：1 s 内 CPU < 300 ms，进程 5 s 内自然退出（0.62.0 上空转到 60 s 期限）；迟到结算与宿主回调仍能推进程序；期限过后仍以超时结束。
    - 证明：`tests/004.test.mjs`
6. [LEMMA 1, 2] Callable 方法返回的类对象保留继承数据、getter 与绑定接收者的方法；宿主不能从桥接对象读到 constructor 或原型。解释命令时不自动调用 toJSON，模型改写 Object.getPrototypeOf 不能改变桥接判定。
    - 证明：`tests/005.test.mjs`。Callable 构造和方法桥原已存在；此条补齐返回类对象的语义，不证明宿主从 vm 外调用模型回调时的硬期限。
7. [LEMMA 6] 宿主可暂停后跨过旧期限，再以新期限恢复或放弃；暂停期间已结算的工作不继续执行。恢复时未重置过期的期限仍超时，恢复后的 post-await 死循环仍受 vm timeout 限制。
    - 证明：`tests/006.test.mjs`
8. [LEMMA 1, 2] 宿主错误只复制既有失败字段；`minimumOutputBudgetBytes` 仅在其为正的安全整数时复制，不转换对象或字符串。判定内建在模型执行前捕获，宿主失败对象不能经此字段进入模型；未捕获的宿主错误编码为失败 sentinel 时保留同一已复制字段。
    - 证明：`tests/003.test.mjs`

2026-10-22 验收边界：Node 22.13.0 上本模块 26 项通过。Bun 1.3.14 上原型逃逸、Callable、安全预算错误字段及未捕获编码、宿主 Promise 暂存/恢复/放弃、重复回调拒绝及超时后迟到结算均通过，但 `002` 与 `006` 的 post-await 无限循环硬期限仍失败。固定上游 663ba59 与宿主旧裸 vm 同源复现也存在该失败；Bun 的 afterEvaluate 微任务不在同步驱动中排水。此项为已有 P1，测试保留，不改 skip 或预算，不据其余通过宣称 Bun 异步硬期限已成立。宿主从 vm 外调用模型回调的 MF01 P1 亦不由本次修复关闭。
