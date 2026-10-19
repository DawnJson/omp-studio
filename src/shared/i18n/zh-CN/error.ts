import type { MessageEntry } from "../index.ts";

export const error = {
  sessionBusy: "任务还在运行，等这一轮结束再试。",
  worktreeShared: "还有其它任务（包括已归档的分叉）共用这个工作区，不能丢弃。",
  forkNoMessage: "没有找到可以分叉的用户消息。",
  exited: "这个任务的 omp 进程退出了（退出码 {code}）。会话已保存。",
  exitedNoCode: "这个任务的 omp 进程退出了。会话已保存。",
  protocol: "和 omp 的通信出错了，已断开。可能是版本不兼容。",
  tooManyTasks: "同时运行的任务太多。先停掉或归档几个再试。",
  worktreeMissing: "这个任务的工作区已被删除，只能查看记录，不能继续对话。",
  reconnect: "重新连接",
  copyDetails: "复制详情",
  model: "模型返回错误：{message}",
  goSignIn: "去登录",
  modelUnavailable: "这个会话用的模型现在不可用。",
  generic: "操作没有完成。",
  startFailed: "没能启动 omp。",
  executableBlocked: "可执行文件不会被直接打开，请在文件夹中显示它。",
  notFound: "找不到对应的任务或项目，可能已被移除。",
} satisfies Record<string, MessageEntry>;
