// 起子进程之前要先做完的启动准备：账号扩展写进 omp 的扩展目录（client-accounts/prepare.ts）、mac / Linux 补登录 shell 的 PATH
// （darwin/login-path.ts）。窗口不等它们，和它们同时创建；会起 omp 的地方（omp 发现流程，之后的服务进程、TSP 任务、`omp <子命令>`
// 都要等 omp 就绪）、git / gh 和内置终端在起进程前等这一个 promise。默认是放行的（单元测试不经过 index.ts）。

let gate: Promise<void> = Promise.resolve();

/** 让之后的子进程等 `work` 结束（成功失败都算结束）；只在启动时、起任何子进程之前调用。 */
export function holdSpawnsUntil(work: Promise<unknown>): void {
  const previous = gate;
  gate = Promise.all([previous, work.then(noop, noop)]).then(noop);
}

/** 起子进程之前等启动准备做完；做完之后是一个已完成的 promise。 */
export function spawnsReady(): Promise<void> {
  return gate;
}

function noop(): void {}
