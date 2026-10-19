// 会话树面板：列出这个任务会话里的用户消息（分叉处缩进），当前分支上的高亮，选中一条就回到它之前（branch）。
// 键盘：↑↓ / Home / End 移动，Enter 选中，Esc 关闭；焦点在面板上，关闭后还给打开前的元素。
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { SessionTreeNode, TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { reportError } from "../../ui/errors.ts";
import { useTitleBarDim } from "../../ui/title-bar-dim.ts";
import { branchToNode } from "./fork-actions.ts";
import { closeSessionTree, useSessionTreeOpen } from "./session-tree-store.ts";
import "./session-tree.css";
import { usePresence, type ExitProps } from "../../ui/presence.ts";

function TreeDialog({
  taskId,
  open,
  closing,
  exitProps,
}: {
  taskId: TaskId;
  open: boolean;
  closing: boolean;
  exitProps: ExitProps;
}) {
  const t = useT();
  useTitleBarDim(open);
  const listId = useId();
  const [nodes, setNodes] = useState<SessionTreeNode[] | null>(null);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);

  useEffect(() => {
    rootRef.current?.focus();
    let cancelled = false;
    window.studio.getSessionTree(taskId).then(
      ({ nodes: loaded }) => {
        if (cancelled) return;
        setNodes(loaded);
        const current = loaded.findIndex((node) => node.current);
        setActive(current >= 0 ? current : Math.max(0, loaded.length - 1));
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

  const close = () => {
    closeSessionTree();
    if (restoreRef.current?.isConnected) restoreRef.current.focus();
  };

  const pick = (node: SessionTreeNode) => {
    close();
    branchToNode(taskId, node.entryId).catch((error: unknown) =>
      reportError(t, error, (message) => t("tree.branchFailed", { message })),
    );
  };

  const count = nodes?.length ?? 0;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (closing) return;
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
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
        if (node) pick(node);
        return;
      }
      case "Tab":
        // 焦点只在面板上。
        event.preventDefault();
        return;
    }
  };

  return (
    <div
      className="tree-root"
      data-testid="session-tree"
      data-closing={closing ? "fade" : undefined}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={rootRef}
        className="tree-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("tree.title")}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        {...exitProps}
      >
        <div className="tree-head">{t("tree.title")}</div>
        {nodes === null ? (
          <p className="tree-note">{t("tree.loading")}</p>
        ) : nodes.length === 0 ? (
          <p className="tree-note">{t("tree.empty")}</p>
        ) : (
          <div
            className="tree-list"
            role="listbox"
            aria-label={t("tree.title")}
            aria-activedescendant={`${listId}-${active}`}
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
                {node.current && <span className="tree-badge">{t("tree.current")}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function SessionTreePanel({ taskId }: { taskId: TaskId }) {
  const open = useSessionTreeOpen(taskId);
  const presence = usePresence(open);
  return presence.mounted ? (
    <TreeDialog taskId={taskId} open={open} closing={presence.closing} exitProps={presence.exitProps} />
  ) : null;
}
