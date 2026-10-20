// TSP 任务输入框正上方的改动条：一行「N 个文件已更改 +a −d · 打开评审」。数据来自 git（工作区相对 HEAD 的改动），
// 不是工具事件的近似。任务运行中保持显示上一次读到的结果（不闪烁、不读一个正在被改写的工作区），
// 一轮结束（状态不再是 running）、或评审里做了暂存/丢弃/提交（git 版本号变）之后重读。没有改动、不是 git 仓库时不显示。
// 过程区（TSP 节点）里不再画改动卡片：那里只有 omp 发来的东西。
import { useEffect, useState } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { useTask } from "../../store/index.ts";
import { openReview } from "../../store/review-store.ts";
import { useGitVersion } from "../git/git-store.ts";
import "./tsp-changes.css";

interface Totals {
  files: number;
  added: number;
  removed: number;
}

export function TspChangeStrip({ taskId }: { taskId: TaskId }) {
  const t = useT();
  const running = useTask(taskId)?.status === "running";
  const version = useGitVersion(taskId);
  const [totals, setTotals] = useState<Totals | null>(null);

  useEffect(() => {
    if (running) return;
    let current = true;
    window.studio.getGitChangeSummary(taskId).then(
      (summary) => {
        if (!current) return;
        if (summary.kind !== "ok" || summary.files.length === 0) return setTotals(null);
        setTotals({
          files: summary.files.length,
          added: summary.files.reduce((sum, file) => sum + (file.added ?? 0), 0),
          removed: summary.files.reduce((sum, file) => sum + (file.removed ?? 0), 0),
        });
      },
      () => current && setTotals(null),
    );
    return () => {
      current = false;
    };
  }, [taskId, running, version]);

  if (totals === null) return null;
  return (
    <div className="change-strip" data-testid="change-strip">
      <span className="change-strip-text">{t("change.summary", { count: totals.files })}</span>
      <span className="change-add">+{totals.added}</span>
      <span className="change-del">−{totals.removed}</span>
      <span className="change-strip-spacer" />
      <button
        type="button"
        className="rv-btn change-review"
        data-testid="change-review"
        onClick={() => openReview(taskId)}
      >
        {t("review.open")}
      </button>
    </div>
  );
}
