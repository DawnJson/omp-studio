// 新任务草稿在输入框下方状态行的位置胶囊（spec §4.14）：文件夹 + 分支。草稿项目正好是 git 仓库根时显示当前分支，
// 点开的菜单只有一个勾选项"在独立 worktree 里开始"；勾上后第一条消息在独立的 git worktree 里开任务（胶囊写成"分支 → 新 worktree"）。
// 不是仓库根的项目只有文件夹标签。没提交、detached HEAD 这类前提在创建被主进程拒绝时记下，勾选项随之禁用并在悬停提示里写明原因。
// 胶囊的悬停提示写明当前分支；项目里有 setup 脚本时也写明创建时会运行它。任务开始后由 TaskPlace 接手（提交 / 推送 / 合并回 / 丢弃）。
import { useEffect, useState } from "react";
import type { DraftGitInfo } from "../../../../shared/git.ts";
import type { ProjectId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Branch, ChevronDown } from "../../icons.tsx";
import { PathLabel } from "../empty/ProjectLabel.tsx";
import { anchorBelow, Menu, type MenuAnchor } from "../../ui/Menu.tsx";
import { setWorktreeOn, useWorktreeDraft } from "./git-store.ts";
import "./git.css";

export function DraftPlace({ projectId, path }: { projectId: ProjectId; path: string }) {
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
  if (loaded === null || git === null) return <PathLabel path={path} />;
  const branch = git.branch ?? t("git.merge.detached");
  const setupNote = loaded.script === null ? null : t("git.draft.setup", { script: loaded.script });
  const title = [
    t("git.bar.branch", { branch }),
    setupNote,
    blocked === null ? null : t("git.draft.blocked", { reason: t(blocked) }),
  ]
    .filter((line) => line !== null)
    .join("\n");

  const toggleMenu = (button: HTMLElement) => setMenu(menu !== null ? null : anchorBelow(button));

  return (
    <>
      <button
        type="button"
        className="place-chip"
        data-testid="draft-git-menu"
        data-worktree={on || undefined}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        aria-label={`${t("git.bar.menu")} · ${path} · ${title.replaceAll("\n", " · ")}`}
        title={title}
        onClick={(event) => toggleMenu(event.currentTarget)}
      >
        <PathLabel path={path} />
        <Branch size={14} />
        <span className="place-chip-branch" data-testid="draft-git-branch">
          {branch}
        </span>
        {on && (
          <span className="place-chip-worktree" data-testid="draft-git-worktree">
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
