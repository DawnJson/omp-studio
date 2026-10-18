// 草稿输入框的"工作树"胶囊（PLAN 阶段 4）：打开后第一条消息会在独立的 git worktree 里开任务。
// 前提（仓库根、有提交、不在 detached HEAD）没有单独的查询接口，创建被主进程拒绝时把原因记下，胶囊随之禁用并在悬停提示里写明。
// 项目里有 setup 脚本时，开启状态下在胶囊内写明"会运行"，悬停提示给出完整文件名。
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

  useEffect(() => {
    let current = true;
    window.studio.getWorktreeSetupScript(projectId).then(
      (name) => current && setScript(name),
      () => current && setScript(null),
    );
    return () => {
      current = false;
    };
  }, [projectId]);

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
