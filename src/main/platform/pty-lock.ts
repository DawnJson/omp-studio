// node-pty 1.1.0 在 Windows 上的原生层（`src/win/conpty.cc`）有数据竞争：所有伪终端的句柄放在一个全局的
// `static std::vector<std::unique_ptr<pty_baton>> ptyHandles` 里，没有任何锁；每个伪终端的"等进程退出"线程在进程一退出就
// `CloseHandle(baton->hShell)` 并 `ptyHandles.erase(...)`（同时释放 baton），而主线程的 `startProcess`（`emplace_back`，可能
// 重新分配整块存储）、`kill`（`find_if`，随后读 `handle->hpc` / `handle->hShell` 调 `TerminateProcess`）、`resize` 同时在读写同一个 vector。
// 症状：进程在这些调用和另一个伪终端退出撞在一起时随机崩溃（退出码 0xC0000005 访问冲突、0xC0000374 堆损坏）。
// 单元测试里并行关掉几个任务、紧接着起新的就会撞上（vitest 的 worker 崩溃，`task-pool` / `task-tsp` / `task-tsp-tree`）；
// 应用里同样的序列是"归档、回收、退出时关任务进程"。
//
// 我们能做的是不让自己触发的这几件事互相重叠：起进程、"结束进程并等它退出"在整个进程里排队，一次一个。
// 这样 taskkill 引发的退出线程做完收尾（`onExit` 到达 = erase 已经完成）之前，不会有别的 spawn / kill 去碰那个 vector。
// 进程自己随时退出（不是我们关的）仍可能和某次调用重叠，那一小段窗口没有办法从这边关上，要靠升级 node-pty（上游修复）。
// 非 Windows 的原生层没有这个问题，直接执行。
let tail: Promise<unknown> = Promise.resolve();

export function withPtyLock<T>(task: () => Promise<T>): Promise<T> {
  if (process.platform !== "win32") return task();
  const result = tail.then(task);
  tail = result.catch(() => undefined);
  return result;
}
