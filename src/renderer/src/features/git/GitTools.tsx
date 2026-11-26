// 输入框下方状态行左端的位置胶囊（spec §4.14）：文件夹 + 分支一个按钮（照终端版 omp 的状态栏标 `*改动 ?未跟踪`，worktree 任务另标领先提交数），
// 点开是 Git 菜单（第一项是打开评审，Ctrl Shift D）；PR 号徽标跟在后面。基分支、改动数、领先提交数的完整说法在胶囊的悬停提示里。
// 任务目录不是 git 仓库（或没有 git）时只有文件夹标签，不能点。
import { useEffect, useState } from "react";
import type { GitStatus } from "../../../../shared/git.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { shortcutLabel } from "../../app/platform-keys.ts";
import { ArrowUp, Branch, ChevronDown, Commit, Diff, External, Trash } from "../../icons.tsx";
import { PathLabel } from "../empty/ProjectLabel.tsx";
import { useTask } from "../../store/index.ts";
import { openReview } from "../../store/review-store.ts";
import { reportError } from "../../ui/errors.ts";
import { anchorBelow, Menu, type MenuAnchor, type MenuEntry } from "../../ui/Menu.tsx";
import { mergeBack, pushBranch } from "./git-actions.ts";
import { openGitDialog } from "./git-dialog-store.ts";
import { useGitVersion, useTaskWorktree } from "./git-store.ts";
import "./git.css";

/** 任务目录的 git 状态：任务一轮结束、git 操作完成（version）时重读；不是仓库或读失败为 null。 */
function useTaskGitStatus(taskId: TaskId): GitStatus | null {
  const task = useTask(taskId);
  const updatedAt = task?.updatedAt ?? 0;
  const version = useGitVersion(taskId);
  // 状态连同它是哪个任务的一起记：切到别的任务的第一帧，上一个任务的分支不能还挂着（不是 git 仓库的任务一个都不该有）。
  const [loaded, setLoaded] = useState<{ taskId: TaskId; status: GitStatus | null } | null>(null);
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
  return loaded?.taskId === taskId ? loaded.status : null;
}

export function TaskPlace({ taskId, path }: { taskId: TaskId; path: string }) {
  const t = useT();
  const task = useTask(taskId);
  const worktree = useTaskWorktree(taskId, task?.updatedAt ?? 0);
  const status = useTaskGitStatus(taskId);
  // 只记打开的位置；菜单项每次渲染现算，开着时切语言或 git 状态变了也跟着变。
  const [menu, setMenu] = useState<MenuAnchor | null>(null);

  if (status?.kind !== "ok") return <PathLabel path={path} testId="composer-folder" />;
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
        id: "review",
        label: t("review.open"),
        icon: <Diff />,
        shortcut: shortcutLabel("Ctrl Shift D"),
        testId: "git-menu-review",
        onSelect: () => openReview(taskId),
      },
      { kind: "separator", id: "sep-review" },
      {
        id: "commit",
        label: t("git.menu.commit"),
        icon: <Commit />,
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

  const openMenu = (button: HTMLElement) => setMenu(anchorBelow(button));

  return (
    <>
      <button
        type="button"
        className="place-chip"
        data-testid="git-menu"
        data-worktree={worktree !== null || undefined}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        aria-label={`${t("git.bar.menu")} · ${path} · ${summary}`}
        title={summary}
        onClick={(event) => openMenu(event.currentTarget)}
      >
        <PathLabel path={path} testId="composer-folder" />
        <Branch size={14} />
        <span className="place-chip-branch" data-testid="git-branch">
          {label}
        </span>
        {changed > 0 && (
          <span className="place-chip-count" data-testid="git-changed">
            *{changed}
          </span>
        )}
        {untracked > 0 && (
          <span className="place-chip-count" data-testid="git-untracked">
            ?{untracked}
          </span>
        )}
        {ahead > 0 && (
          <span className="place-chip-ahead" data-testid="git-ahead">
            ↑{ahead}
          </span>
        )}
        <ChevronDown size={12} />
      </button>
      {task?.prNumber != null && (
        <button
          type="button"
          className="place-pr"
          data-testid="git-pr-badge"
          aria-label={t("git.pr.badge", { number: task.prNumber })}
          title={t("git.pr.badge", { number: task.prNumber })}
          onClick={() => window.studio.openTaskPullRequest(taskId).catch((error: unknown) => reportError(t, error))}
        >
          #{task.prNumber}
        </button>
      )}
      {menu && <div className="git-menu-scrim" />}
      {menu && <Menu anchor={menu} items={menuItems()} label={t("git.bar.menu")} onClose={() => setMenu(null)} />}
    </>
  );
}
