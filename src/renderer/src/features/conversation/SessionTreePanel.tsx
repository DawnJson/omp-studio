// 会话树面板：列出这个任务会话里的用户消息（分叉处缩进），当前分支上的高亮，选中一条就回到它之前（omp 的 /tree）。
// 每行还有"从这里分叉"：新建任务，从那条消息之前接着聊（omp --fork，docs/architecture/session-tree.md）。
// 键盘：↑↓ / Home / End 移动，Enter 选中，Shift+Enter 分叉，Esc 关闭；焦点在面板上，关闭后还给打开前的元素。
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { SessionTreeNode, TaskId } from "../../../../shared/ipc.ts";
import { useTaskIdle } from "../../store/tasks-store.ts";
import { Branch } from "../../icons.tsx";
import { useT } from "../../i18n/use-t.ts";
import { Badge, Checkbox, IconButton } from "../../ui/controls.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { reportError } from "../../ui/errors.ts";
import { branchToNode, forkFromMessage } from "./fork-actions.ts";
import { closeSessionTree, takeSessionTreeFocus, useSessionTreeOpen } from "./session-tree-store.ts";
import { focusIndexFromEnd } from "./tree-focus.ts";
import "./session-tree.css";

function TreeDialog({ taskId, open, onExited }: { taskId: TaskId; open: boolean; onExited(): void }) {
  const t = useT();
  const listId = useId();
  const [nodes, setNodes] = useState<SessionTreeNode[] | null>(null);
  const [active, setActive] = useState(0);
  const [forking, setForking] = useState(false);
  const [summarize, setSummarize] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const idle = useTaskIdle(taskId);
  const activeRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active, nodes]);

  const pick = (node: SessionTreeNode) => {
    if (forking || summarizing) return;
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
    if (forking || summarizing || !idle) return;
    setForking(true);
    forkFromMessage(taskId, node.entryId).then(closeSessionTree, (error: unknown) => {
      setForking(false);
      reportError(t, error, (message) => t("tree.forkFailed", { message }));
    });
  };

  const count = nodes?.length ?? 0;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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
        event.preventDefault();
        setActive(0);
        return;
      case "End":
        event.preventDefault();
        setActive(Math.max(0, count - 1));
        return;
      case "Enter": {
        event.preventDefault();
        const node = nodes?.[active];
        if (node) (event.shiftKey ? fork : pick)(node);
        return;
      }
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
      onExited={onExited}
      footStart={
        nodes !== null && nodes.length > 0 ? (
          <span title={t("tree.summarizeHint")}>
            <Checkbox
              checked={summarize}
              disabled={forking || summarizing}
              testId="session-tree-summarize"
              onChange={setSummarize}
            >
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
        <div
          className="tree-list"
          role="listbox"
          tabIndex={-1}
          data-autofocus=""
          aria-label={t("tree.title")}
          aria-activedescendant={`${listId}-${active}`}
          aria-busy={forking || summarizing}
          onKeyDown={onKeyDown}
        >
          {nodes.map((node, index) => (
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
              data-testid="session-tree-node"
              title={t("tree.pick")}
              style={{ "--indent": node.indent } as CSSProperties}
              onMouseMove={() => setActive(index)}
              onClick={() => pick(node)}
            >
              <span className="tree-text">{node.text === "" ? t("tree.imageOnly") : node.text}</span>
              {node.current && <Badge tone="accent">{t("tree.current")}</Badge>}
              <IconButton
                className="tree-fork"
                label={t("tree.fork")}
                tip={`${t("tree.fork")}\n${t("tree.forkTitle")}`}
                tabIndex={-1}
                testId="session-tree-fork"
                disabled={forking || summarizing || !idle}
                onClick={(event) => {
                  event.stopPropagation();
                  fork(node);
                }}
              >
                <Branch size={14} />
              </IconButton>
            </div>
          ))}
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
