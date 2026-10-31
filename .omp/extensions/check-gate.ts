// omp 项目扩展：主会话要结束一轮时跑 `node scripts/check.ts --gate`（工作区干净直接过，否则跑 lint、格式、类型和仓库规则扫描），
// 没过就用 `{ decision: "block", reason }` 拒绝结束，把检查输出交回给 agent 去修。
// omp 对 block 不设上限（直到 hook 放行或用户打断），所以这里自己数：连续拦 MAX_BLOCKS 次还没过就放行并提示，避免死循环。
// session_stop 只在主会话触发，子代理不跑。omp 从 <cwd>/.omp/extensions 自动加载本文件（omp://extension-loading.md）。
// handler 超过 30 秒 omp 就放行（omp 18.14.0 实测），检查本身要保持在这之内。
// 不引 @oh-my-pi/pi-coding-agent 的类型（仓库不装这个包），只声明用到的几个字段。

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface StopContext {
  cwd: string;
  ui: { notify(message: string, type: "info" | "warning" | "error"): void };
}

interface ExtensionApi {
  exec(command: string, args: string[], options: { cwd: string }): Promise<ExecResult>;
  on(
    event: "session_stop",
    handler: (event: unknown, ctx: StopContext) => Promise<{ decision: "block"; reason: string } | undefined>,
  ): void;
}

const MAX_BLOCKS = 3;

export default function checkGate(pi: ExtensionApi): void {
  let blocks = 0;
  pi.on("session_stop", async (_event, ctx) => {
    const result = await pi.exec("node", ["scripts/check.ts", "--gate"], { cwd: ctx.cwd });
    if (result.code === 0) {
      blocks = 0;
      return undefined;
    }
    const output = `${result.stdout}\n${result.stderr}`.trim();
    if (blocks >= MAX_BLOCKS) {
      blocks = 0;
      ctx.ui.notify(`scripts/check.ts 连续 ${MAX_BLOCKS} 次没过，已放行；运行 npm run check 查看`, "warning");
      return undefined;
    }
    blocks += 1;
    return {
      decision: "block",
      reason: `scripts/check.ts 没过（第 ${blocks}/${MAX_BLOCKS} 次拦截），修好再结束：\n${output}`,
    };
  });
}
