// get_state 里 fast / slow、超限、输出速度、上下文构成几项到 TaskState 的映射（纯函数，task-runner 的 #adoptState 用）。
import type { TaskState } from "../../shared/ipc.ts";
import type { SessionState } from "../../shared/omp-wire/rpc-wire.generated.ts";

export type SessionExtras = Pick<
  TaskState,
  "fastMode" | "slowMode" | "usageLimit" | "tokensPerSecond" | "contextParts"
>;

export const NO_SESSION_EXTRAS: SessionExtras = {
  fastMode: { enabled: false, active: false },
  slowMode: { supported: false, enabled: false, scope: null },
  usageLimit: null,
  tokensPerSecond: null,
  contextParts: null,
};

/** omp 不给分项 token 数，按字符估：ASCII 约 4 字符一个 token，其余（中文等）一个字符一个。 */
function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 4) + other;
}

/** 系统提示词和工具定义各占多少（估算）；omp 没给 systemPrompt 时为 null。 */
function contextParts(state: SessionState): TaskState["contextParts"] {
  if (state.systemPrompt === undefined) return null;
  const tools = state.dumpTools ?? [];
  return {
    systemTokens: estimateTokens(state.systemPrompt.join("\n")),
    toolTokens: tools.length === 0 ? 0 : estimateTokens(JSON.stringify(tools)),
    toolCount: tools.length,
  };
}

export function sessionExtras(state: SessionState): SessionExtras {
  const supported = state.slowModeSupported ?? false;
  const tokensPerSecond = state.tokensPerSecond;
  return {
    fastMode: { enabled: state.fastModeEnabled ?? false, active: state.fastModeActive ?? false },
    // omp 保证不支持时 enabled 为 false、scope 缺省；这里照样收口，界面不用再判。
    slowMode: {
      supported,
      enabled: supported && (state.slowModeEnabled ?? false),
      scope: supported ? (state.slowModeScope ?? null) : null,
    },
    usageLimit: state.usageLimit ?? null,
    tokensPerSecond: typeof tokensPerSecond === "number" && Number.isFinite(tokensPerSecond) ? tokensPerSecond : null,
    contextParts: contextParts(state),
  };
}
