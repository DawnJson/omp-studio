// 没选任务时的主区（spec §4.7、§4.22 H）：有项目 = 项目头 + 草稿输入框 + 继续列表；没有项目 = 选文件夹引导。
import { useEffect, useMemo } from "react";
import { useT } from "../../i18n/use-t.ts";
import { useTasks } from "../../store/index.ts";
import { DraftComposer } from "../composer/index.ts";
import { refreshProjects, useProjectsState } from "../sidebar/projects-store.ts";
import { describeError } from "../../ui/errors.ts";
import { openFolderAsDraft } from "./actions.ts";
import { ContinueList } from "./ContinueList.tsx";
import { pickDraftProject, useDraftProjectId } from "./draft-project.ts";
import { ProjectSwitcher } from "./ProjectSwitcher.tsx";
import { useSessions } from "./use-sessions.ts";
import "./empty.css";

export function EmptyState() {
  const t = useT();
  const { list: projects, loaded, error } = useProjectsState();
  const tasks = useTasks();
  const pickedId = useDraftProjectId();

  // 默认项目 = 最近有操作的任务所在的项目，没有任务时是列表里第一个；用户在菜单里换过就按用户的。
  const fallback = useMemo(() => {
    const latest = tasks.reduce<(typeof tasks)[number] | null>(
      (best, task) => (best === null || task.updatedAt > best.updatedAt ? task : best),
      null,
    );
    return projects.find((project) => project.id === latest?.projectId) ?? projects[0] ?? null;
  }, [projects, tasks]);
  const project = projects.find((candidate) => candidate.id === pickedId) ?? fallback;
  const sessions = useSessions(project);
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
        <ContinueList {...sessions} />
      </div>
    );
  }

  return (
    <div className="empty" data-testid="empty-state" data-kind="project">
      <div className="empty-head">
        <ProjectSwitcher projects={projects} current={project} onPick={(next) => pickDraftProject(next.id)} />
        <span className="empty-path" title={project.path}>
          {project.path}
        </span>
      </div>
      <div className="empty-draft" data-testid="empty-draft">
        <DraftComposer projectId={project.id} />
      </div>
      <ContinueList {...sessions} />
    </div>
  );
}
