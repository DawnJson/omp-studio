// 空状态里新任务要用的项目：用户选过的；没选就是最近有操作的任务所在的项目，没有任务时是列表里第一个。
import { useMemo } from "react";
import type { Project } from "../../../../shared/ipc.ts";
import { useTasks } from "../../store/index.ts";
import { useProjects } from "../sidebar/projects-store.ts";
import { useDraftProjectId } from "./draft-project.ts";

export function useDraftProject(): Project | null {
  const projects = useProjects();
  const tasks = useTasks();
  const pickedId = useDraftProjectId();
  const fallback = useMemo(() => {
    const latest = tasks.reduce<(typeof tasks)[number] | null>(
      (best, task) => (best === null || task.updatedAt > best.updatedAt ? task : best),
      null,
    );
    return projects.find((project) => project.id === latest?.projectId) ?? projects[0] ?? null;
  }, [projects, tasks]);
  return projects.find((candidate) => candidate.id === pickedId) ?? fallback;
}
