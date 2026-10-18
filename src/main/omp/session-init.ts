// 每个 omp 进程握手（ready + negotiate_protocol，已在 OmpConnection.ready 里）之后的固定初始化序列。
// 录制脚本 scripts/record-rpc.ts 也调用这里：假 omp 严格按顺序比对 `in` 帧，所以序列必须只有这一份（docs/architecture/rpc-replay.md）。
import type { ModelKey } from "../../shared/ipc.ts";
import type { AgentMessage, SessionState, ThinkingLevel } from "../../shared/omp-wire/rpc-wire.generated.ts";
import { RpcCommandError, type OmpConnection } from "./omp-connection.ts";

export interface SessionInitOptions {
  /** 恢复这个会话文件（switch_session）。cwd 必须已经是会话自己的 cwd，由启动参数保证。 */
  resumeSessionFile?: string;
  /** 恢复时强制指定的模型：会话里存的模型恢复不了时用它（omp 报 `Could not restore model`）。 */
  restoreModel?: ModelKey;
}

export interface SessionInit {
  /** 服务端确认了增量模式；false 时旧版 omp 仍会发 `partial`，翻译层照样丢掉它。 */
  messageUpdatesDelta: boolean;
  /** ask 对话框已开启；false 时 ask 工具回退成 select + editor。 */
  askDialog: boolean;
  state: SessionState;
  thinkingLevels: ThinkingLevel[];
}

/** 顺序：set_event_filter → set_ask_dialog → set_subagent_subscription → [switch_session] → get_state → get_available_thinking_levels。 */
export async function initializeSession(connection: OmpConnection, options: SessionInitOptions = {}): Promise<SessionInit> {
  const filter = await connection.request("set_event_filter", { events: null, messageUpdates: "delta" });
  let askDialog = true;
  try {
    await connection.request("set_ask_dialog", { enabled: true });
  } catch (error) {
    // 旧版 omp 不认这条命令：保留 select + editor 回退（arch 1.1）。别的错误（进程退出等）照常抛出。
    if (!(error instanceof RpcCommandError)) throw error;
    askDialog = false;
  }
  await connection.request("set_subagent_subscription", { level: "progress" });
  if (options.resumeSessionFile !== undefined) {
    const { cancelled } = await connection.request("switch_session", {
      sessionPath: options.resumeSessionFile,
      ...(options.restoreModel && { provider: options.restoreModel.provider, modelId: options.restoreModel.modelId }),
    });
    if (cancelled) throw new Error("omp cancelled switch_session");
  }
  const state = await connection.request("get_state");
  const { levels } = await connection.request("get_available_thinking_levels");
  return { messageUpdatesDelta: filter.messageUpdates === "delta", askDialog, state, thinkingLevels: levels as ThinkingLevel[] };
}

const HISTORY_PAGE_SIZE = 256;

/** 恢复会话后分页读完整历史（limit 1–256，按时间正序）。流式中会报 session_busy，恢复发生在空闲时所以不会遇到。 */
export async function loadHistory(connection: OmpConnection): Promise<AgentMessage[]> {
  const messages: AgentMessage[] = [];
  let cursor: string | undefined;
  do {
    const page = await connection.request("get_messages_page", { limit: HISTORY_PAGE_SIZE, ...(cursor !== undefined && { cursor }) });
    messages.push(...page.messages);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return messages;
}
