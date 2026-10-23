import type { MessageEntry } from "../index.ts";

export const error = {
  sessionBusy: "任务还在运行，等这一轮结束再试。",
  composerUnavailable: "omp 正在等你回答它的提问或审批，先回答它。",
  screenOpen: "omp 的面板（如 Agent Hub）还开着，先按 Esc 关掉再发送。",
  worktreeShared: "还有其它任务（包括已归档的分叉）共用这个工作区，不能丢弃。",
  forkNoMessage: "没有找到可以分叉的用户消息。",
  exited: "这个任务的 omp 进程退出了（退出码 {code}）。会话已保存。",
  exitedNoCode: "这个任务的 omp 进程退出了。会话已保存。",
  protocol: "和 omp 的通信出错了，已断开。可能是版本不兼容。",
  tooManyTasks: "同时运行的任务太多。先停掉或归档几个再试。",
  worktreeMissing: "这个任务的工作区已被删除，只能查看记录，不能继续对话。",
  model: "模型返回错误：{message}",
  modelUnavailable: "这个会话用的模型现在不可用。",
  generic: "操作没有完成。",
  startFailed: "没能启动 omp。",
  executableBlocked: "可执行文件不会被直接打开，请在文件夹中显示它。",
  notFound: "找不到对应的任务或项目，可能已被移除。",
  statsSchema: "omp 的统计库结构和当前 omp-studio 预期的对不上，读不了。",
} satisfies Record<string, MessageEntry>;
