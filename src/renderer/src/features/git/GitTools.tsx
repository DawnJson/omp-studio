// 任务条右侧的 git 工具：分支胶囊（照终端版 omp 的状态栏标 `*改动 ?未跟踪`，worktree 任务另标领先提交数，点开是 Git 菜单）+ 评审按钮。
// 基分支、改动数、领先提交数的完整说法在胶囊的悬停提示里。任务目录不是 git 仓库（或没有 git）时都不渲染。
import { useEffect, useState } from "react";
import type { GitStatus } from "../../../../shared/git.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { ArrowUp, Branch, Check, ChevronDown, Diff, External, Trash } from "../../icons.tsx";
import { useTask } from "../../store/index.ts";
import { openReview } from "../../store/review-store.ts";
import { IconButton } from "../../ui/controls.tsx";
import { reportError } from "../../ui/errors.ts";
import { anchorBelow, Menu, type MenuAnchor, type MenuEntry } from "../../ui/Menu.tsx";
import { mergeBack, pushBranch } from "./git-actions.ts";
import { openGitDialog } from "./git-dialog-store.ts";
import { useGitVersion, useTaskWorktree } from "./git-store.ts";
import "./git.css";

export function GitTools({ taskId }: { taskId: TaskId }) {
  const t = useT();
  const task = useTask(taskId);
  const updatedAt = task?.updatedAt ?? 0;
  const version = useGitVersion(taskId);
  const worktree = useTaskWorktree(taskId, updatedAt);
  // 状态连同它是哪个任务的一起记：切到别的任务的第一帧，上一个任务的分支按钮不能还挂在顶栏上（不是 git 仓库的任务一个都不该有）。
  const [loaded, setLoaded] = useState<{ taskId: TaskId; status: GitStatus | null } | null>(null);
  const status = loaded?.taskId === taskId ? loaded.status : null;
  // 只记打开的位置；菜单项每次渲染现算，开着时切语言或 git 状态变了也跟着变。
  const [menu, setMenu] = useState<MenuAnchor | null>(null);

  useEffect(() => {
    let current = true;
    window.studio.getGitStatus(taskId).then(
      (value) => current && setLoaded({ taskId, status: value }),
      () => current && setLoaded({ taskId, status: null }),
    );
    return () => {
      current = false;
    };
  }, [taskId, updatedAt, version]);

  if (status?.kind !== "ok") return null;
  const label = worktree?.branch ?? status.branch.head ?? t("git.merge.detached");
  const ahead = worktree?.commitsAhead ?? 0;
  // omp 的 `*N`：有暂存或工作区改动的已跟踪文件（含冲突）；`?N`：未跟踪的文件。
  const untracked = status.files.filter((file) => file.unstaged === "untracked").length;
  const changed = status.files.length - untracked;
  const summary = [
    t("git.bar.branch", { branch: label }),
    worktree && t("git.bar.worktree", { base: worktree.baseBranch }),
    changed > 0 && t("git.bar.changed", { count: changed }),
    untracked > 0 && t("git.bar.untracked", { count: untracked }),
    ahead > 0 && t("git.bar.ahead", { count: ahead }),
  ]
    .filter((part) => typeof part === "string")
    .join(" · ");

  // 动作菜单：图标 + 分隔线；破坏性的"丢弃 worktree…"红字放最后、前面一条分隔线；不可用项第二行写原因。
  const menuItems = (): MenuEntry[] => {
    const items: MenuEntry[] = [
      {
        id: "commit",
        label: t("git.menu.commit"),
        icon: <Check />,
        onSelect: () => openGitDialog({ kind: "commit", taskId }),
      },
      {
        id: "push",
        label: t("git.menu.push"),
        icon: <ArrowUp />,
        ...(!status.canPush && {
          disabledReason: status.branch.head === null ? t("git.push.detached") : t("git.push.noRemote"),
        }),
        onSelect: () => void pushBranch(t, taskId),
      },
    ];
    // 创建 PR 要先推送：没有可用远端（或 detached HEAD）时不可行，直接不列；gh 缺失 / 未登录由结果 toast 说明。
    if (status.canPush) {
      items.push({
        id: "pr",
        label: t("git.menu.pr"),
        icon: <External />,
        onSelect: () => openGitDialog({ kind: "pr", taskId, defaultTitle: task?.title ?? "" }),
      });
    }
    if (worktree) {
      items.push(
        {
          id: "merge",
          label: t("git.menu.merge", { base: worktree.baseBranch }),
          icon: <Branch />,
          onSelect: () => void mergeBack(t, taskId, worktree),
        },
        { kind: "separator", id: "sep-danger" },
        {
          id: "discard",
          label: t("git.menu.discard"),
          icon: <Trash />,
          tone: "danger",
          onSelect: () => openGitDialog({ kind: "discard", taskId, branch: worktree.branch }),
        },
      );
    }
    return items;
  };

  const toggleMenu = (button: HTMLElement) => setMenu(menu !== null ? null : anchorBelow(button));

  return (
    <>
      <button
        type="button"
        className="topbar-branch"
        data-testid="git-menu"
        data-worktree={worktree !== null || undefined}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        aria-label={`${t("git.bar.menu")} · ${summary}`}
        title={summary}
        onClick={(event) => toggleMenu(event.currentTarget)}
      >
        <Branch size={14} />
        <span className="topbar-branch-name" data-testid="git-branch">
          {label}
        </span>
        {changed > 0 && (
          <span className="topbar-branch-count" data-testid="git-changed">
            *{changed}
          </span>
        )}
        {untracked > 0 && (
          <span className="topbar-branch-count" data-testid="git-untracked">
            ?{untracked}
          </span>
        )}
        {ahead > 0 && (
          <span className="topbar-branch-ahead" data-testid="git-ahead">
            ↑{ahead}
          </span>
        )}
        <ChevronDown size={12} />
      </button>
      {task?.prNumber != null && (
        <button
          type="button"
          className="topbar-pr"
          data-testid="git-pr-badge"
          aria-label={t("git.pr.badge", { number: task.prNumber })}
          title={t("git.pr.badge", { number: task.prNumber })}
          onClick={() => window.studio.openTaskPullRequest(taskId).catch((error: unknown) => reportError(t, error))}
        >
          #{task.prNumber}
        </button>
      )}
      <IconButton
        label={t("review.open")}
        tip={`${t("review.open")} (Ctrl Shift D)`}
        testId="topbar-review"
        onClick={() => openReview(taskId)}
      >
        <Diff size={16} />
      </IconButton>
      {menu && <div className="git-menu-scrim" />}
      {menu && <Menu anchor={menu} items={menuItems()} label={t("git.bar.menu")} onClose={() => setMenu(null)} />}
    </>
  );
}
