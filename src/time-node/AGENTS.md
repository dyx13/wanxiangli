# 物理时基

承接 `time/AGENTS.md` 的物理定时器与墙钟职责。唯一共享源码是纯接口 `../time/Temporal.fs`；不编译 Deadline 或虚拟实现，不读取兄弟状态。公开入口 `wanxiangli/time-node`，导出 `NodeTime`。`UtcNow()` 返回真实 JS Date，取消结束等待能力而不创造业务终态。

验收由 time 的001/004/006/008及安装包消费者负责；纯计算和验证时基分别独立编译、打包和消费。
