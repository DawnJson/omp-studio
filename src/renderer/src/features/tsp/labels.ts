// 过程区（TSP 节点）里 studio 自己加的文字：不走 i18n，两种语言都是 omp 原样的英文
// （所有者定：汉化只管 studio 自己的界面——输入框、侧栏、设置、弹窗；任务过程里的内容和 omp 终端一致）。
const plural = (count: number, one: string, other: string): string => `${count} ${count === 1 ? one : other}`;

const STATUS: Record<string, string> = {
  pending: "Pending",
  running: "Running",
  done: "Done",
  error: "Failed",
  cancelled: "Canceled",
};

export const labels = {
  moreLines: (count: number) => plural(count, "more line", "more lines"),
  earlierLines: (count: number) => plural(count, "earlier line", "earlier lines"),
  showLess: "Show less",
  copyCommand: "Copy command",
  noChanges: "No changes",
  unchangedLines: (count: number) => plural(count, "unchanged line", "unchanged lines"),
  imageLoading: "Image loading",
  imageUnavailable: "Image unavailable",
  imageNotArrived: "The image data has not arrived",
  mediaOpen: (path: string) => `Preview ${path}`,
  working: "Working",
  /** 工具 / 子代理的状态名；不认识的状态返回 undefined。 */
  status: (status: string): string | undefined => STATUS[status],
  agentRequests: (count: number) => `${count} req`,
  agentContext: (percent: number) => `${percent}% context`,
  agentRetry: (attempt: number, max: number, delay: string) => `↻ retry ${attempt}/${max} in ${delay}`,
  agentTools: (count: number) => plural(count, "tool call", "tool calls"),
  todos: "Todos",
  todosDone: (done: number, total: number) => `Todos, ${done} of ${total} done`,
  todosOpen: (count: number) => `${count} ${count === 1 ? "todo" : "todos"} still open`,
  allDone: "All done",
  effortAria: (level: string) => `Thinking effort: ${level}`,
  chartEmpty: "No data",
  recapTitle: "Recap while you were away",
};
