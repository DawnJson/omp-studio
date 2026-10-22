// 没选任务时的主区（spec §4.7）：贴底的草稿输入框；上方居中只有 omp 式的像素标志，升级后第一次启动时标志下面有"最近更新"。
// 项目标签在输入框工具行里审批胶囊的右边（是 git 仓库时，顶栏另有分支胶囊，可勾选在 worktree 里开始）。没选项目就是默认文件夹（AppInfo.chatsDir，
// 发送时才建目录、加项目）；换项目走侧栏：项目旁的 ＋、"打开文件夹"，或拖入文件夹。最近的任务和历史会话只在侧栏。
import { useEffect } from "react";
import { useT } from "../../i18n/use-t.ts";
import { DraftComposer } from "../composer/index.ts";
import { refreshProjects, useProjectsState } from "../sidebar/projects-store.ts";
import { describeError } from "../../ui/errors.ts";
import { Button } from "../../ui/controls.tsx";
import { useAppInfo } from "../../store/index.ts";
import { ProjectLabel } from "./ProjectLabel.tsx";
import { StudioHeader } from "./StudioHeader.tsx";
import { useDraftProject } from "./use-draft-project.ts";
import { WhatsNew } from "./WhatsNew.tsx";
import "./empty.css";

export function EmptyState() {
  const t = useT();
  const { loaded, error } = useProjectsState();
  const project = useDraftProject();
  const appInfo = useAppInfo();
  const whatsNew = appInfo?.whatsNew ?? null;

  // 草稿输入框出现后焦点放进去（程序设置的焦点不显示焦点框，只有键盘操作才显示）。
  useEffect(() => {
    if (!loaded) return;
    const active = document.activeElement;
    if (active === null || active === document.body)
      document.querySelector<HTMLElement>("[data-composer-input]")?.focus({ preventScroll: true });
  }, [loaded]);

  if (!loaded && error === null)
    return <div className="empty" data-testid="empty-state" data-kind="loading" aria-busy="true" />;
  if (!loaded) {
    return (
      <div className="empty" data-testid="empty-state" data-kind="error">
        <div className="empty-card" role="alert">
          <p className="empty-error">{t("empty.loadFailed", { message: describeError(t, error) })}</p>
          <Button variant="primary" onClick={() => void refreshProjects()}>
            {t("common.retry")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="empty" data-testid="empty-state" data-kind={project === null ? "no-project" : "project"}>
      <div className="empty-main">
        <StudioHeader>{whatsNew !== null && <WhatsNew summary={whatsNew} />}</StudioHeader>
      </div>
      <div className="empty-draft" data-testid="empty-draft">
        <DraftComposer projectId={project?.id ?? null} projectTools={<ProjectLabel project={project} />} />
      </div>
    </div>
  );
}
