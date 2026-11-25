// 输入框下方的状态行（spec §4.14，所有者定 2026-11-25）：在输入框外、不加底色，和输入框一样宽。
// 左 = 位置胶囊（文件夹 + 分支，点开 Git 菜单；features/git）；右 = 上下文条（点开构成）· 输出速度 · 缓存命中率 · 本会话 token 总数。
// 没有数据的项不画（还没回复时没有速度、没有缓存数据时没有命中率）。窄的时候右边按 tokens → 缓存 → 速度的顺序藏掉，上下文条一直在。
import type { ModelOption, Project, ProjectId, TaskState } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { useAppInfo } from "../../store/index.ts";
import { DraftPlace, TaskPlace } from "../git/index.ts";
import { PathLabel } from "../empty/ProjectLabel.tsx";
import { useSpeed } from "./ModelBreakdown.tsx";
import { ContextMeter, DraftContextMeter } from "./UsageMeter.tsx";
import { cacheHitRate, formatCount, formatPercent } from "./usage-format.ts";

export function TaskStatusLine({ task }: { task: TaskState }) {
  const t = useT();
  const speed = useSpeed(task);
  const usage = task.sessionUsage;
  const hit = usage === null ? null : cacheHitRate(usage.tokens);
  // 整个会话（含压缩前）的总数：压缩后不变小；还没读到会话文件时退回 omp 口径的数
  const total = usage === null ? 0 : (usage.wholeTokens ?? usage.tokens.total);
  return (
    <div className="composer-status" data-testid="composer-status">
      <div className="composer-status-place">
        <TaskPlace taskId={task.id} path={task.cwd} />
      </div>
      <div className="composer-status-stats">
        <ContextMeter task={task} />
        {speed !== null && (
          <span
            className="composer-stat"
            data-stat="speed"
            data-testid="status-speed"
            data-live={speed.live || undefined}
            title={t(speed.live ? "composer.status.speedLive" : "composer.status.speedModel")}
          >
            {t("composer.usage.tps", { n: speed.text })}
          </span>
        )}
        {hit !== null && (
          <span
            className="composer-stat"
            data-stat="cache"
            data-testid="status-cache"
            title={t("composer.usage.cacheHit")}
          >
            {t("composer.status.cache", { p: formatPercent(hit * 100) })}
          </span>
        )}
        {total > 0 && (
          <span
            className="composer-stat"
            data-stat="tokens"
            data-testid="status-tokens"
            title={t("composer.status.tokensTip")}
          >
            {formatCount(total)}
          </span>
        )}
      </div>
    </div>
  );
}

/** 新任务草稿：左边是新任务会在哪（项目是 git 仓库根时带分支和 worktree 选项），右边只有上下文条（占用 0，点开看开场会占多少）。 */
export function DraftStatusLine({ project, model }: { project: Project | null; model: ModelOption | null }) {
  const chatsDir = useAppInfo()?.chatsDir ?? "";
  const projectId: ProjectId | null = project?.id ?? null;
  return (
    <div className="composer-status" data-testid="composer-status">
      <div className="composer-status-place">
        {project === null ? (
          <PathLabel path={chatsDir} />
        ) : (
          <DraftPlace key={project.id} projectId={project.id} path={project.path} />
        )}
      </div>
      <div className="composer-status-stats">
        <DraftContextMeter model={model} projectId={projectId} />
      </div>
    </div>
  );
}
