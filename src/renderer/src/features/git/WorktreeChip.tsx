// 草稿输入框下方的"工作树"开关：打开后第一条消息会在独立的 git worktree 里开任务。
// 只在项目目录正好是 git 仓库根时显示（canUseWorktree）；没提交、detached HEAD 这类前提在创建被主进程拒绝时记下，
// 开关随之禁用并在悬停提示里写明。项目里有 setup 脚本时，开启状态下在开关内写明"会运行"，悬停提示给出完整文件名。
import { useEffect, useState } from "react";
import type { ProjectId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Branch } from "../../icons.tsx";
import { setWorktreeOn, useWorktreeDraft } from "./git-store.ts";
import "./git.css";

export function WorktreeChip({ projectId }: { projectId: ProjectId }) {
  const t = useT();
  const { on, blocked } = useWorktreeDraft(projectId);
  const [script, setScript] = useState<string | null>(null);
  const [usable, setUsable] = useState(false);

  useEffect(() => {
    let current = true;
    setUsable(false);
    window.studio.canUseWorktree(projectId).then(
      (value) => {
        if (!current) return;
        setUsable(value);
        // 用不了的项目不能留着"开"：发送时会照这个开关建 worktree。
        if (!value) setWorktreeOn(projectId, false);
      },
      () => current && setUsable(false),
    );
    window.studio.getWorktreeSetupScript(projectId).then(
      (info) => current && setScript(info?.name ?? null),
      () => current && setScript(null),
    );
    return () => {
      current = false;
    };
  }, [projectId]);

  if (!usable) return null;

  const setupNote = script === null ? null : t("git.chip.setup", { script });
  const title =
    blocked !== null
      ? t("git.chip.blocked", { reason: t(blocked) })
      : [t("git.chip.title"), setupNote].filter((line) => line !== null).join("\n");

  return (
    <button
      type="button"
      className="chip"
      data-testid="worktree-chip"
      data-on={on || undefined}
      aria-pressed={on}
      aria-disabled={blocked !== null}
      title={title}
      onClick={() => {
        if (blocked === null) setWorktreeOn(projectId, !on);
      }}
    >
      <Branch size={14} />
      <span className="chip-text">{t("git.chip.label")}</span>
      {on && script !== null && (
        <span className="chip-note" data-testid="worktree-setup-note">
          {t("git.chip.setup", { script: script.split("/").pop() ?? script })}
        </span>
      )}
    </button>
  );
}
