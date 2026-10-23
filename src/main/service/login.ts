// OAuth 登录：在服务进程上发 RPC `login {providerId}`，登录结束才应答（rpc.md）。过程中 omp 发 extension_ui_request：
//   open_url → 主进程用系统浏览器打开（只放行 http/https），同时推给界面显示可复制的链接；
//   notify   → 进度提示；
//   input    → 转成登录卡里的输入框，界面回答后发 extension_ui_response；
//   其它     → 登录用不到，立刻回 cancelled（和连接层的常驻默认应答共用 extension-ui.ts），免得 omp 一直等；
//   cancel   → omp 撤销了一个 input（超时 / 取消）：推 input_closed，界面收起输入框。
// 登录期间认领 extension UI（claimExtensionUi），连接层的默认应答不会抢答。
// API key 里的 secret 提示 omp 会直接拒绝（登录以失败应答），所以 API key 不走这里（决策 D3）。
// 没有公开的"取消登录"命令：有未答的 input 就回 cancelled，否则关掉服务进程。流程见 docs/architecture/login.md。
import { shell } from "electron";
import type { LoginOutcome } from "../../shared/ipc.ts";
import { emitEvent } from "../ipc/events.ts";
import { parseExternalUrl } from "../ipc/validate.ts";
import { cancelledReply } from "../omp/extension-ui.ts";
import { OmpExitedError, RpcCommandError } from "../omp/omp-connection.ts";
import { serviceOmp } from "./service-omp.ts";

interface ActiveLogin {
  providerId: string;
  /** 界面还没回答的 input：inputId（= 帧 id）。 */
  pendingInputs: Set<string>;
  cancelled: boolean;
  respond(frame: { id: string; value?: string; cancelled?: true }): void;
}

let active: ActiveLogin | null = null;

export async function startLogin(providerId: string): Promise<LoginOutcome> {
  if (active) throw new Error(`a login for ${active.providerId} is already in progress`);
  const login: ActiveLogin = { providerId, pendingInputs: new Set(), cancelled: false, respond: () => {} };
  active = login;
  try {
    await serviceOmp.use(async (connection) => {
      login.respond = (frame) =>
        connection.send({ type: "extension_ui_response", ...frame } as Parameters<typeof connection.send>[0]);
      const release = connection.claimExtensionUi();
      const stop = connection.onFrame((frame) => {
        if (frame.type !== "extension_ui_request") return;
        switch (frame.method) {
          case "open_url": {
            // omp 给的 URL 也当不可信：只放行 http/https。
            const url = parseExternalUrl(frame.url);
            void shell.openExternal(url);
            emitEvent("login", {
              type: "open_url",
              url,
              ...(frame.launchUrl !== undefined && { launchUrl: frame.launchUrl }),
              ...(frame.instructions !== undefined && { instructions: frame.instructions }),
            });
            break;
          }
          case "notify":
            emitEvent("login", { type: "progress", level: frame.notifyType ?? "info", message: frame.message });
            break;
          case "input":
            login.pendingInputs.add(frame.id);
            emitEvent("login", {
              type: "input",
              inputId: frame.id,
              title: frame.title,
              ...(frame.placeholder !== undefined && { placeholder: frame.placeholder }),
            });
            break;
          case "cancel":
            if (login.pendingInputs.delete(frame.targetId))
              emitEvent("login", { type: "input_closed", inputId: frame.targetId });
            break;
          default: {
            const reply = cancelledReply(frame);
            if (reply) login.respond(reply);
            break;
          }
        }
      });
      try {
        await connection.request("login", { providerId });
      } finally {
        stop();
        release();
      }
    });
    return { ok: true, providerId };
  } catch (error) {
    if (login.cancelled) return { ok: false, message: "cancelled" };
    if (error instanceof RpcCommandError || error instanceof OmpExitedError)
      return { ok: false, message: error.message };
    throw error;
  } finally {
    active = null;
  }
}

/** 界面回答一个 input；value 为 null 表示取消这个输入。inputId 必须是还在等的那个。 */
export function answerLoginInput(inputId: string, value: string | null): void {
  if (!active?.pendingInputs.delete(inputId)) throw new Error("no login input is waiting for that answer");
  active.respond(value === null ? { id: inputId, cancelled: true } : { id: inputId, value });
}

/** 取消正在进行的登录。没有登录时什么都不做。 */
export async function cancelLogin(): Promise<void> {
  const login = active;
  if (!login) return;
  login.cancelled = true;
  if (login.pendingInputs.size > 0) {
    for (const inputId of login.pendingInputs) login.respond({ id: inputId, cancelled: true });
    login.pendingInputs.clear();
    return;
  }
  // omp 停在等浏览器回调、没有可取消的输入：只能关掉服务进程，login 随之以失败结束。
  await serviceOmp.close();
}
