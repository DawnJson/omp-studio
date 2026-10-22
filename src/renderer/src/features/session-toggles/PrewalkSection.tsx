// 模型选择器里的 Prewalk 一行（spec §4.14）：先用当前模型规划，omp 在第一次改文件时把会话换成 smol 角色的模型（omp prewalk.md）。
// 三个单发动作：启用 = `/prewalk`、重来 = `/prewalk restart`（换回 default 角色并重新启用）、停用 = `/prewalk off`（文案不写"关闭"：和对话框的"关闭"同字不同义）。
// omp 没有 prewalk 状态查询，只显示它对最近一次命令的回话原文。smol 没设置或和当前模型相同时换不了模型：启用 / 重来禁用，说明原因。
import { useState } from "react";
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import type { ModelOption, TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { useTask } from "../../store/index.ts";
import { reportOmpError } from "../../ui/errors.ts";
import { Button } from "../../ui/controls.tsx";
import { sameModel } from "../composer/model-groups.ts";
import { runToggleCommand } from "./toggle-actions.ts";
import "./toggles.css";

const ops = ["arm", "restart", "off"] as const;

export function PrewalkSection({
  taskId,
  model,
  smol,
}: {
  taskId: TaskId;
  /** 正在生效的模型（规划用它）。 */
  model: ModelOption | null;
  /** smol 角色指的模型；没设置或不在列表里为 null。 */
  smol: ModelOption | null;
}) {
  const t = useT();
  const reply = useTask(taskId)?.sessionToggles.prewalk ?? null;
  const [busy, setBusy] = useState(false);
  const blocked: MessageKey | null =
    smol === null
      ? "toggles.prewalk.noSmol"
      : model !== null && sameModel(model.key, smol.key)
        ? "toggles.prewalk.sameModel"
        : null;

  const run = (op: (typeof ops)[number]) => {
    if (busy) return;
    setBusy(true);
    runToggleCommand(taskId, { kind: "prewalk", op })
      .catch((error: unknown) => reportOmpError(t, error))
      .finally(() => setBusy(false));
  };

  return (
    <div className="mp-ctl" data-testid="model-prewalk">
      <span className="mp-ctl-label">{t("toggles.prewalk")}</span>
      <div className="tg-prewalk">
        <div className="tg-prewalk-head">
          <span className="mp-hint tg-prewalk-plan" data-testid="prewalk-plan">
            {blocked !== null || smol === null
              ? t(blocked ?? "toggles.prewalk.noSmol")
              : t("toggles.prewalk.plan", { from: model?.name ?? t("toggles.prewalk.current"), to: smol.name })}
          </span>
          <span className="tg-actions">
            {ops.map((op) => (
              <Button
                key={op}
                size="sm"
                testId={`prewalk-${op}`}
                disabled={busy || (op !== "off" && blocked !== null)}
                onClick={() => run(op)}
              >
                {t(`toggles.prewalk.${op}`)}
              </Button>
            ))}
          </span>
        </div>
        {reply !== null && (
          <span className="tg-reply" data-testid="prewalk-reply">
            {reply}
          </span>
        )}
      </div>
    </div>
  );
}
