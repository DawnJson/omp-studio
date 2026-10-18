// 主区顶部的 git 条：当前分支（worktree 任务另标出基分支和领先提交数）+ 一个紧凑的 "Git" 菜单。
// 任务目录不是 git 仓库（或没有 git）时整条不渲染，不占位。
import { useEffect, useState } from "react";
import type { GitStatus } from "../../../../shared/git.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Branch, ChevronDown } from "../../icons.tsx";
import { useTask } from "../../store/index.ts";
import { openReview } from "../../store/review-store.ts";
import { Menu, type MenuAnchor, type MenuItem } from "../sidebar/Menu.tsx";
import { mergeBack, pushBranch } from "./git-actions.ts";
import { openGitDialog } from "./git-dialog-store.ts";
import { useGitVersion, useTaskWorktree } from "./git-store.ts";
import "./git.css";

export function GitBar({ taskId }: { taskId: TaskId }) {
  const t = useT();
  const task = useTask(taskId);
  const updatedAt = task?.updatedAt ?? 0;
  const version = useGitVersion(taskId);
  const worktree = useTaskWorktree(taskId, updatedAt);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; items: MenuItem[] } | null>(null);

  useEffect(() => {
    let current = true;
    window.studio.getGitStatus(taskId).then(
      (value) => current && setStatus(value),
      () => current && setStatus(null),
    );
    return () => {
      current = false;
    };
  }, [taskId, updatedAt, version]);

  if (status?.kind !== "ok") return null;
  const branch = status.branch.head ?? t("git.merge.detached");
  const label = worktree?.branch ?? branch;

  const openMenu = (button: HTMLElement) => {
    const box = button.getBoundingClientRect();
    const items: MenuItem[] = [
      { id: "review", label: t("git.menu.review"), onSelect: () => openReview(taskId) },
      { id: "commit", label: t("git.menu.commit"), onSelect: () => openGitDialog({ kind: "commit", taskId }) },
      { id: "push", label: t("git.menu.push"), onSelect: () => void pushBranch(t, taskId) },
      {
        id: "pr",
        label: t("git.menu.pr"),
        onSelect: () => openGitDialog({ kind: "pr", taskId, defaultTitle: task?.title ?? "" }),
      },
    ];
    if (worktree) {
      items.push(
        {
          id: "merge",
          label: t("git.menu.merge", { base: worktree.baseBranch }),
          onSelect: () => void mergeBack(t, taskId, worktree),
        },
        {
          id: "discard",
          label: t("git.menu.discard"),
          onSelect: () => openGitDialog({ kind: "discard", taskId, branch: worktree.branch }),
        },
      );
    }
    setMenu({ anchor: { x: box.left, y: box.bottom + 4, returnFocus: button }, items });
  };

  return (
    <div className="git-bar" data-testid="git-bar" data-worktree={worktree !== null || undefined}>
      <span className="git-branch" data-testid="git-branch" title={t("git.bar.branch", { branch: label })}>
        <Branch size={14} />
        <span className="git-branch-name">{label}</span>
      </span>
      {worktree && (
        <span className="git-meta" data-testid="git-worktree-meta">
          {t("git.bar.worktree", { base: worktree.baseBranch })}
          {worktree.commitsAhead > 0 && ` · ${t("git.bar.ahead", { count: worktree.commitsAhead })}`}
        </span>
      )}
      <span className="git-spacer" />
      <button
        type="button"
        className="chip"
        data-testid="git-menu"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        aria-label={t("git.bar.menu")}
        onClick={(event) => openMenu(event.currentTarget)}
      >
        <span className="chip-text">{t("git.bar.label")}</span>
        <ChevronDown size={12} />
      </button>
      {menu && <Menu anchor={menu.anchor} items={menu.items} label={t("git.bar.menu")} onClose={() => setMenu(null)} />}
    </div>
  );
}
