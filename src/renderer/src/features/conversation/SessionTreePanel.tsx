// 会话树面板：列出这个任务会话里的用户消息、压缩点（context 压缩过的分隔）和分支摘要（回溯时 omp 给被放弃的分支写的），
// 分叉处缩进，当前分支上的高亮；节点上显示 omp `/tree` 里打的标签；顶部搜索框按消息文字 / 标签过滤。
// 选中一条用户消息就回到它之前（omp 的 /tree），回溯前提示"下面 N 轮会离开当前对话"；每行还有"从这里分叉"（omp --fork）和"添加标签"
// （omp /tree 里的 Shift+L，主进程驱动，docs/architecture/session-tree.md）。
// 键盘：↑↓ / Home / End 移动，Enter 选中，Shift+Enter 分叉，Shift+L 打标签，Esc 清搜索 / 关闭；焦点在列表上，关闭后还给打开前的元素。
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { SessionTreeNode, TaskId } from "../../../../shared/ipc.ts";
import { discardedTurns, filterTreeNodes } from "../../../../shared/session-tree-view.ts";
import { useTaskIdle } from "../../store/tasks-store.ts";
import { Branch, Search, Tag } from "../../icons.tsx";
import { useT } from "../../i18n/use-t.ts";
import { Badge, Checkbox, IconButton, TextField } from "../../ui/controls.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { reportError } from "../../ui/errors.ts";
import { branchToNode, forkFromMessage } from "./fork-actions.ts";
import { closeSessionTree, takeSessionTreeFocus, useSessionTreeOpen } from "./session-tree-store.ts";
import { focusIndexFromEnd } from "./tree-focus.ts";
import "./session-tree.css";

interface LabelEdit {
  entryId: string;
  value: string;
  saving: boolean;
}

function TreeDialog({ taskId, open, onExited }: { taskId: TaskId; open: boolean; onExited(): void }) {
  const t = useT();
  const listId = useId();
  const [nodes, setNodes] = useState<SessionTreeNode[] | null>(null);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const [labelEdit, setLabelEdit] = useState<LabelEdit | null>(null);
  const [forking, setForking] = useState(false);
  const [summarize, setSummarize] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const idle = useTaskIdle(taskId);
  const activeRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    window.studio.getSessionTree(taskId).then(
      ({ nodes: loaded }) => {
        if (cancelled) return;
        setNodes(loaded);
        const focus = takeSessionTreeFocus();
        const focused = focus === null ? null : focusIndexFromEnd(loaded, focus);
        const current = loaded.findIndex((node) => node.current);
        setActive(focused ?? (current >= 0 ? current : Math.max(0, loaded.length - 1)));
      },
      (error: unknown) => {
        if (cancelled) return;
        setNodes([]);
        reportError(t, error, (message) => t("tree.loadFailed", { message }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [taskId, t]);

  const visible = useMemo(() => filterTreeNodes(nodes ?? [], query), [nodes, query]);
  const count = visible.length;
  const activeNode = visible[active];
  // 回溯会让当前对话里几轮离开（只对用户消息有意义）；0 轮时不提示。
  const discard = useMemo(
    () => (activeNode?.kind === "user" && nodes !== null ? discardedTurns(nodes, activeNode.entryId) : 0),
    [nodes, activeNode],
  );

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active, visible]);

  const busy = forking || summarizing;

  const pick = (node: SessionTreeNode) => {
    if (busy || node.kind !== "user") return;
    if (summarize) {
      // omp 要调一次模型给被放弃的分支写摘要，等它写完再关面板（期间标题提示，行都不可点）。
      setSummarizing(true);
      branchToNode(taskId, node.entryId, true).then(closeSessionTree, (error: unknown) => {
        setSummarizing(false);
        reportError(t, error, (message) => t("tree.branchFailed", { message }));
      });
      return;
    }
    closeSessionTree();
    branchToNode(taskId, node.entryId).catch((error: unknown) =>
      reportError(t, error, (message) => t("tree.branchFailed", { message })),
    );
  };

  const fork = (node: SessionTreeNode) => {
    if (busy || !idle || node.kind !== "user") return;
    setForking(true);
    forkFromMessage(taskId, node.entryId).then(closeSessionTree, (error: unknown) => {
      setForking(false);
      reportError(t, error, (message) => t("tree.forkFailed", { message }));
    });
  };

  const startLabel = (node: SessionTreeNode) => {
    if (busy || !idle) return;
    setLabelEdit({ entryId: node.entryId, value: node.label ?? "", saving: false });
  };

  const stopLabel = () => {
    setLabelEdit(null);
    listRef.current?.focus();
  };

  const saveLabel = () => {
    if (labelEdit === null || labelEdit.saving) return;
    const { entryId, value } = labelEdit;
    const label = value.trim();
    setLabelEdit({ ...labelEdit, saving: true });
    window.studio
      .labelTreeEntry(taskId, entryId, label === "" ? null : label)
      .then(() => window.studio.getSessionTree(taskId))
      .then(
        ({ nodes: loaded }) => {
          setNodes(loaded);
          stopLabel();
        },
        (error: unknown) => {
          setLabelEdit((current) => (current === null ? null : { ...current, saving: false }));
          reportError(t, error, (message) => t("tree.labelFailed", { message }));
        },
      );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    // 标签输入框自己处理按键（Enter 保存、Esc 取消）。
    if (labelEdit !== null && target instanceof HTMLInputElement && target.dataset["role"] === "label") return;
    const inSearch = target instanceof HTMLInputElement;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((index) => Math.min(count - 1, index + 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        setActive((index) => Math.max(0, index - 1));
        return;
      case "Home":
        if (inSearch) return;
        event.preventDefault();
        setActive(0);
        return;
      case "End":
        if (inSearch) return;
        event.preventDefault();
        setActive(Math.max(0, count - 1));
        return;
      case "Enter": {
        if (event.nativeEvent.isComposing) return;
        event.preventDefault();
        if (activeNode) (event.shiftKey ? fork : pick)(activeNode);
        return;
      }
      case "L":
        if (inSearch || !event.shiftKey || !activeNode) return;
        event.preventDefault();
        startLabel(activeNode);
        return;
      case "Escape":
        // 搜索框里有字时 Esc 先清字，不关面板。
        if (!inSearch || query === "") return;
        event.preventDefault();
        event.stopPropagation();
        setQuery("");
        setActive(0);
        return;
    }
  };

  return (
    <Dialog
      open={open}
      onClose={closeSessionTree}
      size="md"
      title={forking ? t("tree.forking") : summarizing ? t("tree.summarizing") : t("tree.title")}
      testId="session-tree"
      className="tree-dialog"
      lockHeight
      onExited={onExited}
      footStart={
        nodes !== null && nodes.length > 0 ? (
          <span title={t("tree.summarizeHint")}>
            <Checkbox checked={summarize} disabled={busy} testId="session-tree-summarize" onChange={setSummarize}>
              {t("tree.summarize")}
            </Checkbox>
          </span>
        ) : undefined
      }
    >
      {nodes === null ? (
        <p className="tree-note">{t("tree.loading")}</p>
      ) : nodes.length === 0 ? (
        <p className="tree-note">{t("tree.empty")}</p>
      ) : (
        <div className="tree-body" onKeyDown={onKeyDown}>
          <TextField
            width="auto"
            className="tree-search"
            testId="session-tree-search"
            value={query}
            placeholder={t("tree.searchPlaceholder")}
            aria-label={t("tree.searchLabel")}
            leading={<Search size={14} />}
            onChange={(next) => {
              setQuery(next);
              setActive(0);
            }}
          />
          {visible.length === 0 ? (
            <p className="tree-note" data-testid="session-tree-nomatch">
              {t("tree.noMatch")}
            </p>
          ) : (
            <div
              ref={listRef}
              className="tree-list"
              role="listbox"
              tabIndex={-1}
              data-autofocus=""
              aria-label={t("tree.title")}
              aria-activedescendant={`${listId}-${active}`}
              aria-busy={busy}
            >
              {visible.map((node, index) => {
                const editing = labelEdit?.entryId === node.entryId ? labelEdit : null;
                return (
                  <div
                    key={node.entryId}
                    id={`${listId}-${index}`}
                    ref={index === active ? activeRef : undefined}
                    className="tree-row"
                    role="option"
                    aria-selected={index === active}
                    data-active={index === active}
                    data-branch={node.onCurrentBranch}
                    data-current={node.current}
                    data-kind={node.kind}
                    data-testid="session-tree-node"
                    title={node.kind === "user" && editing === null ? t("tree.pick") : undefined}
                    style={{ "--indent": node.indent } as CSSProperties}
                    onMouseMove={() => setActive(index)}
                    onClick={() => pick(node)}
                  >
                    {node.kind === "compaction" && (
                      <span className="tree-text" data-testid="session-tree-compaction">
                        {t("tree.compaction")}
                        {node.tokensBefore !== undefined &&
                          ` · ${t("tree.compactionTokens", { tokens: node.tokensBefore.toLocaleString("en-US") })}`}
                      </span>
                    )}
                    {node.kind === "branch_summary" && (
                      <Badge testId="session-tree-summary-badge">{t("tree.branchSummary")}</Badge>
                    )}
                    {editing !== null ? (
                      <span className="tree-label-edit" onClick={(event) => event.stopPropagation()}>
                        <TextField
                          size="sm"
                          width="100%"
                          testId="session-tree-label-input"
                          data-role="label"
                          autoFocus
                          value={editing.value}
                          disabled={editing.saving}
                          placeholder={t("tree.labelPlaceholder")}
                          aria-label={t("tree.labelInputLabel")}
                          maxLength={200}
                          onChange={(value) => setLabelEdit({ ...editing, value })}
                          onKeyDown={(event) => {
                            if (event.nativeEvent.isComposing) return;
                            if (event.key === "Enter") {
                              event.preventDefault();
                              event.stopPropagation();
                              saveLabel();
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              event.stopPropagation();
                              stopLabel();
                            }
                          }}
                        />
                      </span>
                    ) : (
                      <>
                        {node.label !== undefined && (
                          <Badge tone="warning" testId="session-tree-label">
                            {node.label}
                          </Badge>
                        )}
                        {node.kind !== "compaction" && (
                          <span className="tree-text">
                            {node.text === "" && node.kind === "user" ? t("tree.imageOnly") : node.text}
                          </span>
                        )}
                      </>
                    )}
                    {node.current && <Badge tone="accent">{t("tree.current")}</Badge>}
                    {editing === null && (
                      <IconButton
                        className="tree-act"
                        label={node.label === undefined ? t("tree.addLabel") : t("tree.editLabel")}
                        tip={idle ? undefined : t("tree.labelBusy")}
                        tabIndex={-1}
                        testId="session-tree-label-edit"
                        disabled={busy || !idle}
                        onClick={(event) => {
                          event.stopPropagation();
                          startLabel(node);
                        }}
                      >
                        <Tag size={14} />
                      </IconButton>
                    )}
                    {node.kind === "user" && (
                      <IconButton
                        className="tree-act"
                        label={t("tree.fork")}
                        tabIndex={-1}
                        testId="session-tree-fork"
                        disabled={busy || !idle}
                        onClick={(event) => {
                          event.stopPropagation();
                          fork(node);
                        }}
                      >
                        <Branch size={14} />
                      </IconButton>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {/* 提示行始终占一行：悬停 / 方向键换节点时它出现、消失，外框高度不变 */}
          <p
            className="tree-hint"
            role={discard > 0 ? "status" : undefined}
            aria-hidden={discard > 0 ? undefined : true}
            data-testid={discard > 0 ? "session-tree-discard" : undefined}
            data-count={discard > 0 ? discard : undefined}
          >
            {discard > 0 ? t("tree.discard", { count: discard }) : "\u00a0"}
          </p>
        </div>
      )}
    </Dialog>
  );
}

export function SessionTreePanel({ taskId }: { taskId: TaskId }) {
  const open = useSessionTreeOpen(taskId);
  // Dialog 自己放退出动画：打开时挂上，动画放完（onExited）才卸载，面板里的状态随之重置。
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  return shown ? <TreeDialog taskId={taskId} open={open} onExited={() => setShown(false)} /> : null;
}
