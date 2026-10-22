// 新任务草稿的顶栏分支胶囊：草稿项目正好是 git 仓库根时显示当前分支，点开的菜单只有一个勾选项"在独立 worktree 里开始"；
// 勾上后第一条消息在独立的 git worktree 里开任务（胶囊写成"分支 → 新 worktree"）。默认文件夹和不是仓库根的项目不显示。
// 没提交、detached HEAD 这类前提在创建被主进程拒绝时记下，勾选项随之禁用并在悬停提示里写明原因。
// 胶囊的悬停提示写明 worktree 是什么；项目里有 setup 脚本时也写明创建时会运行它。任务开始后由 GitTools 接手（提交 / 推送 / 合并回 / 丢弃）。
import { useEffect, useState } from "react";
import type { DraftGitInfo } from "../../../../shared/git.ts";
import type { ProjectId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Branch, ChevronDown } from "../../icons.tsx";
import { Menu, type MenuAnchor } from "../sidebar/Menu.tsx";
import { setWorktreeOn, useWorktreeDraft } from "./git-store.ts";
import "./git.css";

export function DraftGitTools({ projectId }: { projectId: ProjectId }) {
  const t = useT();
  const { on, blocked } = useWorktreeDraft(projectId);
  // 连同它是哪个项目的一起记：切换草稿项目的第一帧，上一个项目的分支不能还挂在顶栏上。
  const [loaded, setLoaded] = useState<{
    projectId: ProjectId;
    git: DraftGitInfo | null;
    script: string | null;
  } | null>(null);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);

  useEffect(() => {
    let current = true;
    Promise.all([
      window.studio.getDraftGit(projectId),
      window.studio.getWorktreeSetupScript(projectId).then((info) => info?.name ?? null),
    ]).then(
      ([git, script]) => {
        if (!current) return;
        setLoaded({ projectId, git, script });
        // 用不了的项目不能留着"开"：发送时会照这个开关建 worktree。
        if (git === null) setWorktreeOn(projectId, false);
      },
      () => {
        if (!current) return;
        setLoaded({ projectId, git: null, script: null });
        setWorktreeOn(projectId, false);
      },
    );
    return () => {
      current = false;
    };
  }, [projectId]);

  const git = loaded?.projectId === projectId ? loaded.git : null;
  if (loaded === null || git === null) return null;
  const branch = git.branch ?? t("git.merge.detached");
  const setupNote = loaded.script === null ? null : t("git.draft.setup", { script: loaded.script });
  const title = [
    t("git.bar.branch", { branch }),
    t("git.draft.title"),
    setupNote,
    blocked === null ? null : t("git.draft.blocked", { reason: t(blocked) }),
  ]
    .filter((line) => line !== null)
    .join("\n");

  const toggleMenu = (button: HTMLElement) => {
    if (menu !== null) {
      setMenu(null);
      return;
    }
    const box = button.getBoundingClientRect();
    setMenu({ x: box.left, y: box.bottom + 4, returnFocus: button });
  };

  return (
    <>
      <button
        type="button"
        className="topbar-branch"
        data-testid="draft-git-menu"
        data-worktree={on || undefined}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        aria-label={`${t("git.bar.menu")} · ${title.replaceAll("\n", " · ")}`}
        title={title}
        onClick={(event) => toggleMenu(event.currentTarget)}
      >
        <Branch size={14} />
        <span className="topbar-branch-name" data-testid="draft-git-branch">
          {branch}
        </span>
        {on && (
          <span className="topbar-branch-worktree" data-testid="draft-git-worktree">
            → {t("git.draft.on")}
          </span>
        )}
        <ChevronDown size={12} />
      </button>
      {menu && <div className="git-menu-scrim" />}
      {menu && (
        <Menu
          anchor={menu}
          label={t("git.bar.menu")}
          onClose={() => setMenu(null)}
          items={[
            {
              id: "worktree",
              label: t("git.draft.worktree"),
              checked: on,
              ...(blocked !== null && { disabledReason: t("git.draft.blocked", { reason: t(blocked) }) }),
              onSelect: () => setWorktreeOn(projectId, !on),
            },
          ]}
        />
      )}
    </>
  );
}
