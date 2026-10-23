// omp 的 `/login <provider>` 在 TSP 里的流程（应用内登录对话框，docs/architecture/login.md "应用内登录"）。纯函数，主进程每次文档变化时调用。
//
// 依据是 omp 18.12.6 的实测录制（fixtures/tsp/login-*.jsonl，test/tsp-login-flow.test.ts 逐帧验证）：
// - 登录窗是 layer 里的 modal `overlay`，role `omp.overlay.login`；输入步骤（企业域名、区域、粘贴授权码）里有 `input` 节点，
//   设备码步骤里有 `omp.login.code`（带 `href` = 设备码）、`omp.login.url`、`omp.btn` 的 open / copy 动作。
// - 取消（Cancel 按钮、Esc）：登录窗和输入框一起被删，status toast 变成 "Login cancelled"（`set` 已有的 toast 节点，不是新增）。
// - 失败：同一帧里 main 末尾多一个 text，文字 "Error: Login failed: <原因>"（omp 的 `showError`），登录窗被删。
// - 成功：omp 在 main 里 `present` 一行 "<图标> Successfully logged in to <provider>[ as <账号>]" 再关登录窗；凭据在那之前已经写进 agent.db。
//   **成功的帧没有实测**（没有真实账号），文字出自 omp 18.12.6 源码 `selector-controller.ts`。
// role 和文字都是 omp 自己的，不在 TSP 规范里：omp 改了这条规则就失效，所以判断集中在这里。
import { nodeRole, plainText, type TspDocument } from "./document.ts";

/** 登录窗（overlay）的 role；omp 用 `omp.overlay.<名字>` 命名所有模态窗。 */
const LOGIN_OVERLAY_ROLE = "omp.overlay.login";
const STATUS_TOAST_ROLE = "omp.toast.status";
const SUCCESS_PATTERN = /Successfully logged in to\b/;
const FAILED_PATTERN = /Login failed:\s*([\s\S]*)$/;
const CANCELLED_TEXT = "Login cancelled";

export type LoginFlowState =
  /** 登录窗还没出现，也没有结果（omp 刚启动，或 `/login` 还在处理）。 */
  | { kind: "idle" }
  /** 登录窗开着，等用户操作或等浏览器里的授权完成。 */
  | { kind: "running" }
  | { kind: "success" }
  | { kind: "cancelled" }
  | { kind: "failed"; message: string };

/** 一个 `/login` 会话的文档里现在是什么状态。结果优先于"登录窗开着"：结果文字和登录窗被删在同一帧，成功时文字还可能早一帧。 */
export function deriveLoginFlow(doc: TspDocument): LoginFlowState {
  let running = false;
  let cancelled = false;
  let failed: string | null = null;
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface) continue;
    for (const node of surface.nodes.values()) {
      const role = nodeRole(node);
      if (node.k === "overlay" && role !== null && role.startsWith(LOGIN_OVERLAY_ROLE)) running = true;
      else if (node.k === "toast" && role === STATUS_TOAST_ROLE)
        cancelled ||= plainText(node).trim() === CANCELLED_TEXT;
      else if (node.k === "text") {
        const text = plainText(node);
        if (SUCCESS_PATTERN.test(text)) return { kind: "success" };
        const match = FAILED_PATTERN.exec(text);
        if (match) failed ??= (match[1] ?? "").trim();
      }
    }
  }
  if (failed !== null) return { kind: "failed", message: failed };
  if (cancelled) return { kind: "cancelled" };
  return running ? { kind: "running" } : { kind: "idle" };
}
