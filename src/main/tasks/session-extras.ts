// get_state 里 fast / slow、超限、输出速度几项到 TaskState 的映射（纯函数，task-runner 的 #adoptState 用）。
import type { TaskState } from "../../shared/ipc.ts";
import type { SessionState } from "../../shared/omp-wire/rpc-wire.generated.ts";

export type SessionExtras = Pick<TaskState, "fastMode" | "slowMode" | "usageLimit" | "tokensPerSecond">;

export const NO_SESSION_EXTRAS: SessionExtras = {
  fastMode: { enabled: false, active: false },
  slowMode: { supported: false, enabled: false, scope: null },
  usageLimit: null,
  tokensPerSecond: null,
};

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
  };
}
