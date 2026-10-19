// 没选任务时的主区（spec §4.7）：贴底的草稿输入框；上方居中是 omp 式的像素标志，升级后第一次启动时标志下面有"最近更新"，
// 有项目时再下面是项目切换和该项目最近 3 个任务。
// 没有项目时同样可以直接发送：任务在 AppInfo.chatsDir 里开始（发送时才建目录、加项目）；加项目走侧栏或拖入文件夹。
// 历史会话只在侧栏（搜索框能搜到），这里不再列。
import { useEffect } from "react";
import { useT } from "../../i18n/use-t.ts";
import { DraftComposer } from "../composer/index.ts";
import { refreshProjects, useProjectsState } from "../sidebar/projects-store.ts";
import { describeError } from "../../ui/errors.ts";
import { PixelLogo } from "../../ui/PixelLogo.tsx";
import { useAppInfo } from "../../store/index.ts";
import { pickDraftProject } from "./draft-project.ts";
import { ProjectSwitcher } from "./ProjectSwitcher.tsx";
import { RecentTasks } from "./RecentTasks.tsx";
import { useDraftProject } from "./use-draft-project.ts";
import { WhatsNew } from "./WhatsNew.tsx";
import "./empty.css";

export function EmptyState() {
  const t = useT();
  const { list: projects, loaded, error } = useProjectsState();
  const project = useDraftProject();
  const appInfo = useAppInfo();
  const version = appInfo?.version ?? null;
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
          <button type="button" className="empty-primary" onClick={() => void refreshProjects()}>
            {t("common.retry")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="empty" data-testid="empty-state" data-kind={project === null ? "no-project" : "project"}>
      <div className="empty-main">
        <div className="empty-hero">
          <PixelLogo version={version} />
          {whatsNew !== null && <WhatsNew summary={whatsNew} />}
          {project !== null && (
            <ProjectSwitcher projects={projects} current={project} onPick={(next) => pickDraftProject(next.id)} />
          )}
        </div>
        {project !== null && <RecentTasks projectId={project.id} />}
      </div>
      <div className="empty-draft" data-testid="empty-draft">
        <DraftComposer projectId={project?.id ?? null} />
      </div>
    </div>
  );
}
