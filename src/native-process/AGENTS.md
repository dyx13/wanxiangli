# 两个物理入口共享的私有I/O

只有`BunProcess.fs`，由Process和Supervision两个工程明确编译，没有npm入口。它转换实际Bun.spawn、FileSink、输出流及spawn/exit/close事件，拥有每个child的I/O接线状态；不保存ProcessSession状态、监管账本、业务完成或持久归属。

detached由调用方明确传入：基础会话拥有独立进程组，监管目标留在Worker组内。写入须等全部字节及flush确认，部分或失败不补写；exit不代替两路输出关闭。共享只为删除真实重复I/O实现，不引入通用服务树或可配置后端框架。

验收由Process与Supervision的真实消费者、ENOENT、完整输出、TERM/KILL及安装包反例承担。Bun原生Capture背压仍未兑现，不能以事件包装或lazy声明冒充修复。
