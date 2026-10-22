# Whole-run 恢复预算增量

当前 `ProviderFailureBudget` 的 `recorded*` 合同持有完整运行的失败与成功身份、首次持久预算、计数/原因冲突、耗尽及重放决策。主仓只映射类型、验证实际授权并写入事实；旧公开 window API 和原测试期待保留。

本机验证基于源码树 `915e99a40bbbd172dbbb608d5374af51b866d872`；归档时仅更新本文与 AGENTS 验收记录，程序源码和产物不变。Node v22.13.0，Bun v1.3.14，独立 Fable 构建退出 0。

| 验证 | 结果 |
| --- | --- |
| `npm test` 完整 Node 套件 | 1,022 项，1,015 pass / 0 fail / 7 skip / 0 TODO；退出 0 |
| Bun failure-budget 原四例与新六例 | 10 pass / 0 fail；退出 0 |
| 实际临时包安装，Node22/Bun 消费 | 均退出 0；60 次重置后身份全保留、冲突原因拒绝、旧成功不清新失败、旧 API 可用 |

临时包 `wanxiangli-0.66.1.tgz` SHA256：`24953f9b4cb16dc15fda1c74f6a03ae166d6f59b4fc2b8f5e99e05e54aa438d4`。原始日志位于 `/private/tmp/m22-library-recorded-budget-*`。

本收据仅证明库增量及真实公开包消费，不代证主仓完整发行。主仓须继续运行原 requirement 和发行门禁。此前 Bun VM post-await 无限循环的两项硬期限失败仍保持原结论，未被本轮纯预算验证覆盖，不关闭 MF-01。
