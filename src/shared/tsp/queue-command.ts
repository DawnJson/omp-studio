// "等这一轮结束再发"：运行中把消息交给 omp 的 `/queue <文字>`（omp 18.12.6 的 TUI 内置命令，`builtin-modes.ts` 的 `queue`、
// `input-controller.ts` 的 `handleQueueCommand`）：这一轮结束（agent 让出）之后再作为 follow-up 发出；运行中的 `send` 是插话（steer）。
// omp 自己的规则：文字像编号清单（`1. a` / `2. b` / `A) c`，编号连续）时按条拆成多条 follow-up；文字为空报用法。
// 以 `/`、`!`、`$` 开头的文字是命令 / shell / eval：原样发（`/queue /compact` 不是用户要的，命令本来就按顺序执行）。
export function followUpText(text: string): string {
  return /^[/!$]/.test(text) ? text : `/queue ${text}`;
}
