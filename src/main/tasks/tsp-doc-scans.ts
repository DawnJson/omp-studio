// TspRunner 每应用一条 TSP 消息都要推导的几项里，有五项要把活 surface 的全部节点扫一遍（待办 HUD、状态 toast 文字、
// 旁路提问弹窗、还在跑的工具 / 子代理、已完成的子代理）。对话越长扫得越多，而流式输出的绝大多数消息只改正文节点、和这几项无关。
// 这里按消息的 ApplyResult.changed 判断相关节点有没有变（NodeWatch），没变就直接给上一次的结果，变了才重扫。
// 各项只读：活 surface（o / x 才变）里某些 kind 的节点自己的记录；旁路提问的弹窗和便签另读整棵子树（答案流式追加在很深的 md 里），
// 所以再从每个变了的节点往上找祖先 overlay / 便签。删子树时每个后代都进 changed、它的父节点也换了记录；弹窗和便签的根节点由
// NodeWatch 记着，删掉的部分照样能发现。
import { isAgentActive, listAgents, type HubAgent } from "../../shared/tsp/agent-hub.ts";
import {
  BTW_NOTE_ROLES,
  findBtwNotes,
  findBtwView,
  isBtwHiddenNode,
  type BtwNote,
  type BtwView,
} from "../../shared/tsp/btw.ts";
import { statusToastTexts } from "../../shared/tsp/composer-state.ts";
import type { ApplyResult, TspDocMessage, TspDocument } from "../../shared/tsp/document.ts";
import { NodeWatch } from "../../shared/tsp/node-watch.ts";
import { hasRunningWork } from "../../shared/tsp/task-status.ts";
import { deriveTodoPhases } from "../../shared/tsp/todos.ts";
import type { TodoPhase } from "../../shared/omp-wire/rpc-wire.generated.ts";

export class TspDocScans {
  readonly document: TspDocument;
  readonly #todoWatch: NodeWatch;
  readonly #toastWatch: NodeWatch;
  readonly #workWatch: NodeWatch;
  readonly #btwWatch: NodeWatch;
  // undefined = 相关节点变过，下次读时重扫。
  #todoPhases: TodoPhase[] | undefined;
  #toastTexts: string[] | undefined;
  #btwView: BtwView | null | undefined;
  #btwNotes: BtwNote[] | undefined;
  #runningWork: boolean | undefined;
  #doneAgents: ReadonlySet<string> | undefined;
  #activeAgents: ReadonlySet<string> | undefined;
  #agents: readonly HubAgent[] | undefined;

  constructor(document: TspDocument) {
    this.document = document;
    this.#todoWatch = new NodeWatch(document, { kinds: ["checklist"] });
    this.#toastWatch = new NodeWatch(document, { kinds: ["toast"] });
    this.#workWatch = new NodeWatch(document, { kinds: ["tool", "agent"] });
    this.#btwWatch = new NodeWatch(document, { kinds: ["overlay"], roles: BTW_NOTE_ROLES });
  }

  /** 一条消息应用之后调用（TspSession 的 onChange）。 */
  observe(message: TspDocMessage, result: ApplyResult): void {
    const { changed } = result;
    if (changed.size === 0) return;
    // o / x 换掉整份节点表或改了哪些 surface 是活的；move 改了子树的位置。changed 描述不了这几种，整份重扫。
    const reset =
      message.verb === "o" ||
      message.verb === "x" ||
      (message.verb === "f" && message.body.ops.some((op) => Array.isArray(op) && op[0] === "move"));
    const doc = this.document;
    if (this.#todoWatch.update(doc, changed, reset).size > 0) this.#todoPhases = undefined;
    if (this.#toastWatch.update(doc, changed, reset).size > 0) this.#toastTexts = undefined;
    if (this.#workWatch.update(doc, changed, reset).size > 0) {
      this.#runningWork = undefined;
      this.#doneAgents = undefined;
      this.#activeAgents = undefined;
      this.#agents = undefined;
    }
    if (this.#btwWatch.update(doc, changed, reset).size > 0 || this.#insideBtw(changed)) {
      this.#btwView = undefined;
      this.#btwNotes = undefined;
    }
  }

  /** 变了的节点在不在 overlay（旁路提问弹窗）或旁路提问便签（omp 19，main 里）里。 */
  #insideBtw(changed: ApplyResult["changed"]): boolean {
    for (const [sf, ids] of changed) {
      const nodes = this.document.surfaces.get(sf)?.nodes;
      if (!nodes) continue;
      for (const id of ids) {
        for (
          let node = nodes.get(id);
          node !== undefined;
          node = node.parent === null ? undefined : nodes.get(node.parent)
        )
          if (node.k === "overlay" || isBtwHiddenNode(node)) return true;
      }
    }
    return false;
  }

  /** deriveTodoPhases；没变时是同一个数组。 */
  get todoPhases(): TodoPhase[] {
    return (this.#todoPhases ??= deriveTodoPhases(this.document));
  }

  /** statusToastTexts；没变时是同一个数组。 */
  get toastTexts(): string[] {
    return (this.#toastTexts ??= statusToastTexts(this.document));
  }

  /** findBtwView；没变时是同一个对象。 */
  get btwView(): BtwView | null {
    if (this.#btwView === undefined) this.#btwView = findBtwView(this.document);
    return this.#btwView;
  }

  /** findBtwNotes；没变时是同一个数组。 */
  get btwNotes(): BtwNote[] {
    return (this.#btwNotes ??= findBtwNotes(this.document));
  }

  /** hasRunningWork。 */
  get runningWork(): boolean {
    return (this.#runningWork ??= hasRunningWork(this.document));
  }

  /** 状态是 done 的子代理名（listAgents 去重之后；被唤醒的子代理在 omp 的节点上一直是 done，issue #23）。 */
  get doneAgents(): ReadonlySet<string> {
    return (this.#doneAgents ??= new Set(
      this.#agentList.filter((agent) => agent.status === "done").map((agent) => agent.name),
    ));
  }

  /** 在跑（运行中或等待）的子代理名。 */
  get activeAgents(): ReadonlySet<string> {
    return (this.#activeAgents ??= new Set(
      this.#agentList.filter((agent) => isAgentActive(agent.status)).map((agent) => agent.name),
    ));
  }

  get #agentList(): readonly HubAgent[] {
    return (this.#agents ??= listAgents(this.document));
  }
}
