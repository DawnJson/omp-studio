// 没选任务时的主区（spec §4.7）：贴底的草稿输入框；上方居中只有 omp 式的像素标志，升级后第一次启动时标志下面有"最近更新"。
// 项目选择和工作树开关在输入框下方一行。没有项目时同样可以直接发送：任务在 AppInfo.chatsDir 里开始
// （发送时才建目录、加项目）；加项目走侧栏、项目菜单的"打开文件夹…"或拖入文件夹。最近的任务和历史会话只在侧栏。
import { useEffect } from "react";
import { useT } from "../../i18n/use-t.ts";
import { DraftComposer } from "../composer/index.ts";
import { WorktreeChip } from "../git/index.ts";
import { refreshProjects, useProjectsState } from "../sidebar/projects-store.ts";
import { describeError } from "../../ui/errors.ts";
import { PixelLogo } from "../../ui/PixelLogo.tsx";
import { useAppInfo } from "../../store/index.ts";
import { pickDraftProject } from "./draft-project.ts";
import { ProjectSwitcher } from "./ProjectSwitcher.tsx";
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
        </div>
      </div>
      <div className="empty-draft" data-testid="empty-draft">
        <DraftComposer
          projectId={project?.id ?? null}
          footer={
            <>
              <ProjectSwitcher projects={projects} current={project} onPick={(next) => pickDraftProject(next.id)} />
              {project !== null && <WorktreeChip projectId={project.id} />}
            </>
          }
        />
      </div>
    </div>
  );
}
