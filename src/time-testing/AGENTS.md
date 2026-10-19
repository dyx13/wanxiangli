# 验证时基

承接 `time/AGENTS.md` 的确定性虚拟时钟和定时器。唯一共享源码为纯接口 `../time/Temporal.fs`；不读取物理时间、不安排物理定时器、不导入 Deadline 或 NodeTime。公开入口 `wanxiangli/time-testing`，导出 `TimeTesting`，仅用于验证。

取消一个句柄不能取消兄弟等待；推进顺序和实例隔离由 time 的001/003/004/007/008及真实安装包消费验证。生产 Time 和 NodeTime 产物不得依赖本模块。
