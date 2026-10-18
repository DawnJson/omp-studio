// 没选任务时的主区（spec §4.7、§4.22 H）：有项目 = 项目头 + 该项目最近 3 个任务 + 贴底的草稿输入框；没有项目 = 选文件夹引导。
// 历史会话只在侧栏（搜索框能搜到），这里不再列。
import { useEffect } from "react";
import { useT } from "../../i18n/use-t.ts";
import { DraftComposer } from "../composer/index.ts";
import { refreshProjects, useProjectsState } from "../sidebar/projects-store.ts";
import { describeError } from "../../ui/errors.ts";
import { Logo } from "../../ui/Logo.tsx";
import { openFolderAsDraft } from "./actions.ts";
import { pickDraftProject } from "./draft-project.ts";
import { ProjectSwitcher } from "./ProjectSwitcher.tsx";
import { RecentTasks } from "./RecentTasks.tsx";
import { useDraftProject } from "./use-draft-project.ts";
import "./empty.css";

export function EmptyState() {
  const t = useT();
  const { list: projects, loaded, error } = useProjectsState();
  const project = useDraftProject();
  const hasDraft = loaded && project !== null;

  // 草稿输入框出现后焦点放进去（程序设置的焦点不显示焦点框，只有键盘操作才显示）。
  useEffect(() => {
    if (!hasDraft) return;
    const active = document.activeElement;
    if (active === null || active === document.body)
      document.querySelector<HTMLElement>("[data-composer-input]")?.focus({ preventScroll: true });
  }, [hasDraft]);

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

  if (project === null) {
    return (
      <div className="empty" data-testid="empty-state" data-kind="no-project">
        <div className="empty-card" title={t("empty.chooseProjectHint")}>
          <h1 className="empty-title">{t("empty.chooseProject")}</h1>
          <button
            type="button"
            className="empty-primary"
            data-testid="empty-open-folder"
            onClick={() => void openFolderAsDraft(t)}
          >
            {t("empty.openFolder")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="empty" data-testid="empty-state" data-kind="project">
      <div className="empty-main">
        <div className="empty-head">
          <Logo size={52} className="empty-logo" />
          <div className="empty-head-text">
            <ProjectSwitcher projects={projects} current={project} onPick={(next) => pickDraftProject(next.id)} />
            <span className="empty-path" title={project.path}>
              {project.path}
            </span>
          </div>
        </div>
        <RecentTasks projectId={project.id} />
      </div>
      <div className="empty-draft" data-testid="empty-draft">
        <DraftComposer projectId={project.id} />
      </div>
    </div>
  );
}
