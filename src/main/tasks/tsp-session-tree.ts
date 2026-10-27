// 会话树、回溯、分叉（docs/architecture/session-tree.md）。
// 树只读会话文件（tsp/session-tree-file.ts）；回溯 = 驱动 omp 自己的 `/tree`：选择器里 activate 那条用户消息。
// 分叉成新任务由池完成（TaskPool.forkTask）：新任务用 `omp --fork=<会话文件>` 起，起来以后在新进程里同样回溯。
import type { RestoredDraft, SessionTreeView } from "../../shared/ipc.ts";
import type { TspDocument } from "../../shared/tsp/document.ts";
import {
  SUMMARY_NO,
  TREE_ACT_LABEL,
  TREE_ACT_LABEL_SAVE,
  findComposerEditor,
  findSummaryPicker,
  findTreeLabelInput,
  findTreePicker,
  hasNavigatedToast,
} from "../../shared/tsp/session-tree.ts";
import type { TspSession } from "../tsp/tsp-session.ts";
import {
  buildTreeFromEntries,
  findUserEntry,
  isLabellableEntry,
  readSessionEntries,
  type LeafOverride,
  type RewindTarget,
  type SessionEntry,
} from "../tsp/session-tree-file.ts";
import { CONFIRM_TIMEOUT_MS, ESC_KEY, PICKER_TIMEOUT_MS } from "./tsp-commands.ts";

/** 回溯完成后等 omp 的输入框预填/toast 的上限（等不到不算失败）。 */
const NAVIGATION_SETTLE_MS = 1_500;
/** 回溯时让 omp 摘要被放弃的分支：要调一次模型，实测约 10 秒，留足余量。 */
const SUMMARY_TIMEOUT_MS = 120_000;

export interface TspSessionTreeHost {
  /** 当前会话文件；还没有为 null。 */
  sessionFile(): string | null;
  /** 回溯和分叉要求这一轮已经结束：没结束时抛错。 */
  assertTurnFinished(): void;
  /** 起进程并等握手完成（已在运行时立即返回）。 */
  start(): Promise<void>;
  /** 当前会话；没有进程为 null。 */
  session(): TspSession | null;
  /** 当前会话；没有进程时抛错。 */
  liveSession(): TspSession;
  /** 等输入框就绪（不往审批里发）。 */
  awaitComposer(): Promise<{ sf: string; id: string }>;
  awaitDocument<T>(check: (document: TspDocument) => T | null, timeoutMs: number, timeoutMessage: string): Promise<T>;
  /** 任务的界面操作队列（一次只做一个）。 */
  exclusive<T>(job: () => Promise<T>): Promise<T>;
  /** 取走 omp 输入框里的草稿并清空它；本来就空返回 null。 */
  takeEditorText(session: TspSession): Promise<RestoredDraft | null>;
}

export class TspSessionTree {
  readonly #host: TspSessionTreeHost;
  /** 回溯之后、文件还没有新条目之前的叶子位置（`/tree` 在进程内移动叶子，不写文件）。 */
  #leafOverride: LeafOverride | null = null;

  constructor(host: TspSessionTreeHost) {
    this.#host = host;
  }

  async #readTreeEntries(): Promise<SessionEntry[]> {
    const file = this.#host.sessionFile();
    return file === null ? [] : await readSessionEntries(file);
  }

  /** 会话树面板的数据；还没有会话文件时 nodes 为空。 */
  async getSessionTree(): Promise<SessionTreeView> {
    return { nodes: buildTreeFromEntries(await this.#readTreeEntries(), this.#leafOverride) };
  }

  /**
   * 分叉前的检查：这一轮已结束，`entryId`（null = 当前分支最后一条用户消息）是这个会话的用户消息。
   * 返回要分叉的会话文件、那条消息的条目 id 和回溯目标（omp 的 `--fork` 复制整份文件，条目 id 不变，新进程里直接用它回溯）。
   */
  async prepareFork(entryId: string | null): Promise<{ sourceFile: string; entryId: string; target: RewindTarget }> {
    this.#host.assertTurnFinished();
    const file = this.#host.sessionFile();
    const entries = await this.#readTreeEntries();
    if (file === null || entries.length === 0) throw new Error("this task has no session file yet");
    const id =
      entryId ??
      buildTreeFromEntries(entries, this.#leafOverride).findLast((node) => node.kind === "user" && node.onCurrentBranch)
        ?.entryId;
    if (id === undefined) throw new Error("the session has no user message to fork from");
    const target = findUserEntry(entries, id);
    if (target === null) throw new Error("that is not a user message of this session");
    return { sourceFile: file, entryId: id, target };
  }

  /**
   * 就地回到一条用户消息之前：omp 的 `/tree` → 选择器里 activate 它（同一个会话文件里移动叶子，不新建文件；实测 omp 18.12.5）。
   * omp 会把这条消息填进它自己的输入框；这里把输入框清空（omp 只在输入框为空时才预填，留着会让下一次回溯拿不到文字）
   * 并返回消息的完整文字（取自会话文件），由渲染进程放进 studio 的输入框。
   * `known`：调用方已经从会话文件里查好的目标（新分叉的任务：它的会话文件路径要等 omp 报告，不一定已经到了）；不传就读本任务的会话文件。
   * `summarize`：让 omp 给被放弃的分支写摘要再移动（选择器的 `summarize` 动作 = Shift+Enter，不管 `branchSummary.enabled` 开没开都直接摘要，
   * 会调一次模型，最长等 SUMMARY_TIMEOUT_MS）；不摘要时如果 omp 开着 `branchSummary.enabled` 并弹出"Summarize branch?"，答 No summary。
   */
  rewindTo(entryId: string, known?: RewindTarget, summarize = false): Promise<{ text: string; summarized: boolean }> {
    return this.#host.exclusive(async () => {
      const target = known ?? findUserEntry(await this.#readTreeEntries(), entryId);
      if (target === null) throw new Error("that is not a user message of this session");
      await this.#host.start();
      this.#host.assertTurnFinished();
      const composer = await this.#host.awaitComposer();
      const session = this.#host.liveSession();
      await this.#host.takeEditorText(session);
      session.sendEvent({ ev: "send", sf: composer.sf, id: composer.id, text: "/tree" });
      const picker = await this.#host.awaitDocument(
        (document) => findTreePicker(document),
        PICKER_TIMEOUT_MS,
        "omp's session tree did not open in time",
      );
      if (!picker.items.includes(entryId) || (summarize && !picker.actions.includes("summarize"))) {
        session.sendKeys(ESC_KEY);
        throw new Error("omp's session tree does not offer that");
      }
      if (summarize) {
        session.sendEvent({ ev: "select", sf: picker.sf, id: picker.id, item: entryId });
        session.sendEvent({ ev: "action", sf: picker.sf, id: picker.id, act: "summarize" });
        try {
          await this.#host.awaitDocument(
            (document) => (findTreePicker(document) === null && findSummaryPicker(document) === null ? true : null),
            SUMMARY_TIMEOUT_MS,
            "omp did not finish summarizing the abandoned branch",
          );
        } catch (error) {
          session.sendKeys(ESC_KEY);
          throw error;
        }
      } else {
        session.sendEvent({ ev: "activate", sf: picker.sf, id: picker.id, item: entryId });
        try {
          const outcome = await this.#host.awaitDocument(
            (document) =>
              findSummaryPicker(document) ? "prompt" : findTreePicker(document) === null ? "closed" : null,
            CONFIRM_TIMEOUT_MS,
            "omp did not move to that message",
          );
          const prompt = outcome === "prompt" ? findSummaryPicker(session.document) : null;
          if (prompt !== null) {
            session.sendEvent({ ev: "activate", sf: prompt.sf, id: prompt.id, item: SUMMARY_NO });
            await this.#host.awaitDocument(
              (document) => (findSummaryPicker(document) === null ? true : null),
              CONFIRM_TIMEOUT_MS,
              "omp did not leave its summary prompt",
            );
          }
        } catch (error) {
          session.sendKeys(ESC_KEY);
          throw error;
        }
      }
      // 选择器关了；输入框的预填（或 toast）可能晚一帧到。等不到不算失败：文字取自会话文件。
      await this.#host
        .awaitDocument(
          (document) =>
            hasNavigatedToast(document) || (findComposerEditor(document)?.text ?? "") !== "" ? true : null,
          NAVIGATION_SETTLE_MS,
          "omp did not report the navigation",
        )
        .catch((error: unknown) => {
          if (this.#host.session() !== session) throw error;
        });
      await this.#host.takeEditorText(session);
      this.#leafOverride =
        target.lastEntryId === null ? null : { afterEntryId: target.lastEntryId, leafId: target.parentId };
      return { text: target.text, summarized: summarize };
    });
  }

  /**
   * 给会话树里的一个条目打标签 / 清掉标签（`label` 为 null 或空串 = 清除）：omp 的 `/tree` 选择器里 `select` 这个条目 → `action label`（Shift+L）→
   * 选择器预览里出现输入框 → `edit` 填字（整段替换）→ `action label-save`（Enter）→ omp 往会话文件追加一个 `label` 条目 → Esc 关选择器。
   * 标签不动叶子，也不动对话。要求这一轮已结束。条目必须是会话里存在的用户消息 / 压缩点 / 分支摘要，且 omp 的选择器里列着它。
   */
  labelEntry(entryId: string, label: string | null): Promise<void> {
    return this.#host.exclusive(async () => {
      if (!isLabellableEntry(await this.#readTreeEntries(), entryId)) throw new Error("that entry cannot be labelled");
      const text = label === null ? "" : label.trim();
      await this.#host.start();
      this.#host.assertTurnFinished();
      const composer = await this.#host.awaitComposer();
      const session = this.#host.liveSession();
      await this.#host.takeEditorText(session);
      session.sendEvent({ ev: "send", sf: composer.sf, id: composer.id, text: "/tree" });
      const picker = await this.#host.awaitDocument(
        (document) => findTreePicker(document),
        PICKER_TIMEOUT_MS,
        "omp's session tree did not open in time",
      );
      if (!picker.items.includes(entryId) || !picker.actions.includes(TREE_ACT_LABEL)) {
        session.sendKeys(ESC_KEY);
        throw new Error("omp's session tree does not offer labelling that entry");
      }
      try {
        session.sendEvent({ ev: "select", sf: picker.sf, id: picker.id, item: entryId });
        session.sendEvent({ ev: "action", sf: picker.sf, id: picker.id, act: TREE_ACT_LABEL });
        const input = await this.#host.awaitDocument(
          (document) => findTreeLabelInput(document),
          CONFIRM_TIMEOUT_MS,
          "omp did not open its label box",
        );
        if (input.text !== text) {
          session.sendEvent({
            ev: "edit",
            sf: input.sf,
            id: input.id,
            from: 0,
            to: input.text.length,
            text,
            cursor: text.length,
            len: input.text.length,
          });
          await this.#host.awaitDocument(
            (document) => (findTreeLabelInput(document)?.text === text ? true : null),
            CONFIRM_TIMEOUT_MS,
            "omp's label box did not take the text",
          );
        }
        session.sendEvent({ ev: "action", sf: input.sf, id: input.pickerId, act: TREE_ACT_LABEL_SAVE });
        await this.#host.awaitDocument(
          (document) => (findTreeLabelInput(document) === null ? true : null),
          CONFIRM_TIMEOUT_MS,
          "omp did not save the label",
        );
      } finally {
        // 不管成败都把选择器关掉：它是 modal，开着会挡住别的操作。
        session.sendKeys(ESC_KEY);
      }
      await this.#host.awaitDocument(
        (document) => (findTreePicker(document) === null ? true : null),
        CONFIRM_TIMEOUT_MS,
        "omp did not close its session tree",
      );
    });
  }
}
