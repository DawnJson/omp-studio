// 子代理面板对 omp Agent Hub 的后台驱动（spec §4.28）：插话、结束、恢复三个动作 omp 只在 Hub 里提供，没有别的通道，
// 所以主进程替用户在后台走一遍 Hub 的操作，再把 omp 恢复成原样（Hub 关掉、退出聚焦），渲染进程在这期间不画 omp 的 Hub。
//
// 每一步的事件、等的条件和依据见 shared/tsp/agent-hub.ts 头部（omp 18.12.5 录制 hub-steer / hub-kill，另在真实 omp 上量过
// 聚焦行的退出按钮 `focus:Main`：toast "Returned to main session"，子代理照常运行）：
//   插话  agents.open → [activate item=名字] → 聚焦行出现 → send 文字 → 回显 → focus:Main → 聚焦行消失
//   结束  agents.open → [select 名字] → action kill → 该项 dot=error → Esc 关 Hub
//   恢复  agents.open → [select 名字] → action revive（omp 禁用时用它给的原因抛错）→ 该项不再 error → Esc 关 Hub
// 没有子代理在跑时 hud 里没有 `👥`：改成给输入框发 `/hub`（打开后页签不在 agents 就发 `action tab`）。
// 整个过程在任务的界面操作队列里（和切模型共用的 #exclusive），期间 `drive` 标志为真：TspRunner 不往主会话发别的消息（等它结束）。
// 出错或超时一律走"恢复"：Hub 开着就发 Esc、聚焦着就发退出按钮（不灵再发 Esc）；恢复不了就以明确的错误抛出，不吞。
import {
  HUB_ACTION_KILL,
  HUB_ACTION_REVIVE,
  HUB_ACTION_TAB,
  HUB_OPEN_ACTION,
  HUB_SLASH,
  HUB_TAB_AGENTS,
  countEchoNodes,
  findAgentHub,
  findFocus,
  findHubOpener,
  hubActionState,
  hubItemKilled,
  isAgentName,
  listAgents,
  type AgentHubView,
} from "../../shared/tsp/agent-hub.ts";
import type { TspDocument } from "../../shared/tsp/document.ts";
import { findMessageTarget } from "../../shared/tsp/gate.ts";
import type { TspEvent } from "../../shared/tsp/tsp.generated.ts";
import { TSP_COMPOSER_UNAVAILABLE } from "../../shared/tsp/composer-state.ts";
import { log } from "../log/log.ts";

const ESC_KEY = "\x1b";
/** Hub 打开、聚焦、动作生效各自等 omp 的上限。 */
const HUB_OPEN_TIMEOUT_MS = 8_000;
const HUB_FOCUS_TIMEOUT_MS = 8_000;
const HUB_ACTION_TIMEOUT_MS = 6_000;
/** 插话发出后等 omp 回显（用户消息 / 排队消息节点）的上限；等不到不算失败（子代理可能很快处理完、回显被收掉）。 */
const HUB_ECHO_TIMEOUT_MS = 3_000;
/** 恢复主输入框：每一种办法等多久再换下一种。 */
const HUB_RESTORE_STEP_MS = 3_000;
/** 恢复不了时的错误（渲染进程原样显示）。 */
export const HUB_RESTORE_FAILED =
  "omp's Agent Hub could not be closed after the operation; press Esc in the task or restart it";

export interface HubHost {
  /** 当前文档（原地更新）；没有进程为 null。 */
  document(): TspDocument | null;
  sendEvent(event: TspEvent): void;
  sendKeys(data: string): void;
  awaitDocument<T>(check: (document: TspDocument) => T | null, timeoutMs: number, timeoutMessage: string): Promise<T>;
  /** 任务的界面操作队列（一次只做一个）。 */
  exclusive<T>(job: () => Promise<T>): Promise<T>;
  /** 驱动期间为 true：宿主不往主会话发别的消息；变回 false 时唤醒它们。 */
  setDriving(on: boolean): void;
}

export class HubDriver {
  readonly #host: HubHost;

  constructor(host: HubHost) {
    this.#host = host;
  }

  /** 给子代理插一句话：打开 Hub、聚焦它、往同一个输入框 `send`、退出聚焦。 */
  steer(name: string, text: string): Promise<void> {
    return this.#run(name, async () => {
      const hub = await this.#openHub();
      this.#assertListed(hub, name);
      this.#host.sendEvent({ ev: "activate", sf: hub.sf, id: hub.id, item: name });
      await this.#host.awaitDocument(
        (document) => (findFocus(document)?.name === name ? true : null),
        HUB_FOCUS_TIMEOUT_MS,
        `omp did not switch to subagent ${name}`,
      );
      const target = await this.#composer();
      const document = this.#document();
      const echoBefore = countEchoNodes(document);
      this.#host.sendEvent({ ev: "send", sf: target.sf, id: target.id, text });
      await this.#host
        .awaitDocument(
          (doc) => (countEchoNodes(doc) > echoBefore ? true : null),
          HUB_ECHO_TIMEOUT_MS,
          "omp did not echo the message",
        )
        .catch(() => undefined);
    });
  }

  /** 结束（kill）一个子代理。已经是结束状态时什么也不做。 */
  kill(name: string): Promise<void> {
    return this.#run(name, async () => {
      const hub = await this.#openHub();
      this.#assertListed(hub, name);
      if (hubItemKilled(hub, name)) return;
      const selected = await this.#select(hub, name);
      const state = hubActionState(selected, HUB_ACTION_KILL);
      if (state.state === "missing") throw new Error("omp's Agent Hub has no kill action");
      if (state.state === "disabled") throw new Error(state.reason ?? "omp does not allow killing this agent");
      this.#host.sendEvent({ ev: "action", sf: selected.sf, id: selected.id, act: HUB_ACTION_KILL });
      await this.#host.awaitDocument(
        (document) => {
          const current = findAgentHub(document);
          if (current === null) throw new Error("omp's Agent Hub closed before the kill finished");
          return hubItemKilled(current, name) ? true : null;
        },
        HUB_ACTION_TIMEOUT_MS,
        `omp did not kill ${name}`,
      );
    });
  }

  /** 恢复（revive）被结束或挂起的子代理；omp 不允许时（运行中的不能恢复）用它给的原因抛错。 */
  revive(name: string): Promise<void> {
    return this.#run(name, async () => {
      const hub = await this.#openHub();
      this.#assertListed(hub, name);
      const selected = await this.#select(hub, name);
      const state = hubActionState(selected, HUB_ACTION_REVIVE);
      if (state.state === "missing") throw new Error("omp's Agent Hub has no revive action");
      if (state.state === "disabled") throw new Error(state.reason ?? "omp does not allow reviving this agent");
      this.#host.sendEvent({ ev: "action", sf: selected.sf, id: selected.id, act: HUB_ACTION_REVIVE });
      await this.#host.awaitDocument(
        (document) => {
          const current = findAgentHub(document);
          if (current === null) throw new Error("omp's Agent Hub closed before the revive finished");
          return hubItemKilled(current, name) ? null : true;
        },
        HUB_ACTION_TIMEOUT_MS,
        `omp did not revive ${name}`,
      );
    });
  }

  // ───── 共用步骤 ─────

  /** 校验名字（来自渲染进程，不可信：必须是文档里确有的子代理）→ 排队 → 标志 → 做 → 无论成败都恢复。 */
  #run<T>(name: string, job: () => Promise<T>): Promise<T> {
    return this.#host.exclusive(async () => {
      // 不为它起进程：子代理只存在于正在运行的 omp 的文档里（没有进程 = 没有子代理）。
      const document = this.#document();
      if (!isAgentName(name) || !listAgents(document).some((agent) => agent.name === name))
        throw new Error(`unknown subagent: ${name}`);
      // 有提问/审批在等时不碰 Hub（聚焦后的 `send` 会拒绝审批）。
      const gate = findMessageTarget(document);
      if (gate.kind === "ask" || (gate.kind === "ready" && gate.approval)) throw new Error(TSP_COMPOSER_UNAVAILABLE);
      this.#host.setDriving(true);
      let failure: unknown = null;
      let result: T | undefined;
      try {
        result = await job();
      } catch (error) {
        failure = error;
      }
      let restored = false;
      try {
        restored = await this.#restore();
      } finally {
        this.#host.setDriving(false);
      }
      if (failure !== null) throw failure;
      if (!restored) throw new Error(HUB_RESTORE_FAILED);
      return result as T;
    });
  }

  #document(): TspDocument {
    const document = this.#host.document();
    if (!document) throw new Error("task has no running omp process");
    return document;
  }

  /** 主输入框（没有提问、没有审批在等）：用于发 `/hub` 和聚焦后的插话。 */
  #composer(): Promise<{ sf: string; id: string }> {
    return this.#host.awaitDocument(
      (document) => {
        const target = findMessageTarget(document);
        if (target.kind === "ask" || (target.kind === "ready" && target.approval))
          throw new Error(TSP_COMPOSER_UNAVAILABLE);
        // `panel`：Hub 已经开着（驱动中途）也算没有可发的地方，由调用方先处理 Hub。
        if (target.kind === "panel") throw new Error("an omp panel is open");
        return target.kind === "ready" ? { sf: target.sf, id: target.id } : null;
      },
      HUB_OPEN_TIMEOUT_MS * 4,
      "omp's input box did not become ready in time",
    );
  }

  async #openHub(): Promise<AgentHubView> {
    const document = this.#document();
    let hub = findAgentHub(document);
    if (hub === null) {
      const opener = findHubOpener(document);
      if (opener) {
        this.#host.sendEvent({ ev: "action", sf: opener.sf, id: opener.id, act: HUB_OPEN_ACTION });
      } else {
        const target = await this.#composer();
        this.#host.sendEvent({ ev: "send", sf: target.sf, id: target.id, text: HUB_SLASH });
      }
      hub = await this.#host.awaitDocument(findAgentHub, HUB_OPEN_TIMEOUT_MS, "omp's Agent Hub did not open in time");
    }
    if (hub.tab !== HUB_TAB_AGENTS) {
      this.#host.sendEvent({ ev: "action", sf: hub.sf, id: hub.id, act: HUB_ACTION_TAB, value: HUB_TAB_AGENTS });
      hub = await this.#host.awaitDocument(
        (doc) => {
          const current = findAgentHub(doc);
          return current !== null && current.tab === HUB_TAB_AGENTS ? current : null;
        },
        HUB_ACTION_TIMEOUT_MS,
        "omp's Agent Hub did not switch to its agents page",
      );
    }
    return hub;
  }

  #assertListed(hub: AgentHubView, name: string): void {
    if (!hub.items.some((item) => item.id === name)) throw new Error(`${name} is not listed in omp's Agent Hub`);
  }

  /** 把 picker 的选中项换成 `name`（kill / revive 作用于选中项）；已经选中就不发。 */
  async #select(hub: AgentHubView, name: string): Promise<AgentHubView> {
    if (hub.selected === name) return hub;
    this.#host.sendEvent({ ev: "select", sf: hub.sf, id: hub.id, item: name });
    return this.#host.awaitDocument(
      (document) => {
        const current = findAgentHub(document);
        return current !== null && current.selected === name ? current : null;
      },
      HUB_ACTION_TIMEOUT_MS,
      `omp's Agent Hub did not select ${name}`,
    );
  }

  // ───── 恢复 ─────

  /** Hub 关掉、聚焦退出；返回是否确认恢复（进程已经没了也算恢复）。从不抛错：调用方先报原来的错误。 */
  async #restore(): Promise<boolean> {
    try {
      if (!(await this.#closeHub())) return this.#host.document() === null;
      if (!(await this.#leaveFocus())) return this.#host.document() === null;
      return true;
    } catch (error) {
      log.warn("restoring the omp composer after driving the Agent Hub failed", { message: String(error) });
      return this.#host.document() === null;
    }
  }

  async #gone(check: (document: TspDocument) => boolean): Promise<boolean> {
    try {
      await this.#host.awaitDocument(
        (document) => (check(document) ? true : null),
        HUB_RESTORE_STEP_MS,
        "not restored",
      );
      return true;
    } catch {
      return false;
    }
  }

  async #closeHub(): Promise<boolean> {
    const document = this.#host.document();
    if (!document || findAgentHub(document) === null) return true;
    this.#host.sendKeys(ESC_KEY);
    return this.#gone((doc) => findAgentHub(doc) === null);
  }

  async #leaveFocus(): Promise<boolean> {
    const document = this.#host.document();
    const focus = document ? findFocus(document) : null;
    if (!document || !focus) return true;
    if (focus.exit) this.#host.sendEvent({ ev: "action", sf: focus.sf, id: focus.exit.id, act: focus.exit.act });
    else this.#host.sendKeys(ESC_KEY);
    if (await this.#gone((doc) => findFocus(doc) === null)) return true;
    this.#host.sendKeys(ESC_KEY);
    return this.#gone((doc) => findFocus(doc) === null);
  }
}
