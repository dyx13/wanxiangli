# 0.6.12：输入尾部与回执边界

固定候选SHA256：`a039ba669299c6919776196fd9b462624bcbe515d03593804596dbc86f43ac56`。22个交付文件与主仓663实际安装逐字节一致，见`receipt.json`。不发布npm，不改变公开API、控制文件格式或Written的第一跳确认范围。

## 已确认与修正

0.6.10的Bun输入iterator在仍有17字节缓冲时返回done。原主仓661/662完整19项保留多次18/19；私有仓库的真实Git对象分别少最后17字节。低扰累计与EOF余量针证明：parent已送达，普通source.read取出完整尾17，随后原生fd0读0；不能归目标写端或比较器。诊断故意不转发余量，不算修复验收。

生产改为显式readable/end/close泵：读取和写回调共用一个在途许可；读尽缓冲、取得真正end且最后写回调完成后才end目标。读取期间同步事件不能重入，已报错后不能继续写；close无end是故障。目标拒收只退订转发，不销毁借用stdin，不丢后续输出或补写输入。

Bun私有写端另把成功complete整体交给setImmediate，保留退出/错误在发布前即时裁决Unknown及晚到成功guard。0.6.11此局部边界已通过，但物理尾17仍红，故它不是尾丢根因修复。原生回调重入机制与iterator漏交分开记账。

## 实际验收

- 源码Process/Supervision：Node94项88pass/0fail/6个Bun专用skip；Bun94/94。独立owner编译2/2。
- 两项受控Bun原生确认/退出通知先红后绿。实际cat仍有自己的真实退出；注入23通知不是实际exit23证明。
- 两Host共6个非作者实际Worker检查点：同步read事件重入、read后受控error不再写、最后真实写回调待决时不end；另2项实际拒收后输出/终结。source错误用受控事件，不冒称原生OS读错；探针插入点依赖固定生成代码，仅作固定候选可重放验收，不加公共test hook。
- 实际安装包两Host各6项物理验收：32/64MiB+17目标原件及回显、确切拒收后双路输出/exit23、待决写入KILL后Unknown。参与原型者执行这组验收，不计非作者算法复审。
- 主仓663原完整19项：Node正式监督19/19、owned accepted，Bun原生及非作者固定包各19/19；同一真实F#编译消费者只换包，双Host通过。主仓的实际存储、Host、旧实现退出与最终集成结论由其D2报告承接。

## 证据边界

各档案保留原命令、输入、对象、差异、原始日志和清理记录；SHA集中在`receipt.json`。成功大字节省略仅发生在明确标注的compact档内，逐项size/hash及重生依据保留；失败原件没有省略。

原型缺少同步read重入保护、目录fd0在Bun构造process.stdin时抛EISDIR而非泵读取分支，均在原型档明确纠正。0.6.11局部通过、661/662红和0.6.12通过不互相覆盖。没有证明整个运行时RSS、未测平台、PTY、跨重启清账或R12-U1。

重放源码：`node scripts/build.mjs process supervision`，随后分别执行`node --test src/process/tests/*.test.mjs src/supervision/tests/*.test.mjs`、`bun test src/process/tests/*.test.mjs src/supervision/tests/*.test.mjs`。固定产物探针按各档README重放，先核对原tar和所有文件SHA，不使用工作树产物替代。
