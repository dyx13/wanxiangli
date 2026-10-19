# SM-02C 固定库候选与交付证据

2026-10-19，输入SM-02B提交57a5f1e，候选0.8.1。当前16个公开入口同时保留上游新增模块与本地核心保证，运行依赖为源码；历史取证归档按原路径和SHA-256保留。

## 验收

- 正式 `npm test`：16模块Fable构建成功；563项，556pass、0fail、7skip、0TODO。七个skip保留运行时/平台限制，不当通过。原始完整输出见同目录 `wanxiangli-sm02c-library.log`。
- 新增实际包闭包测试 `node --test scripts/tests/exports-package.test.mjs`：3pass、0fail/skip/TODO。真实npm pack与隔离安装逐文件对照原始产物，16个import/types均存在，Node/Bun在包外实际导入；没有证据归档、F#源码、编译器或额外运行依赖进入artifact。
- 原索引测试先因15份历史tgz证据失败。修正规则后检查Git索引只保留固定清单中的旧归档，逐份摘要不变，manifest没有tarball依赖，发行白名单不含evidence；1pass、0fail。旧红保留。
- 原始日志保留运行器的空白和字节；`.gitattributes`仅对evidence日志禁用换行规范化和行尾空白检查，源程序仍受普通diff检查。SM-02B初次diff-check仅报原始失败日志的空格行，未因此重写日志。

## 交付及边界

库源与原始证据提交到自有fork的main后，主仓只记录确切gitlink；推送前确认origin/main的8422617是本候选祖先，使用普通快进，不强推。源码根与原运行中的修复分支不切换。

当前证据来自macOS、Node26.6.0、Bun1.3.14。最低Node22.13的最终主仓验证、真实Host、状态切换和后续SM-03—SM-07尚未完成。没有registry发布、Host部署或非作者复审；不销原CUT/GAP父项。
