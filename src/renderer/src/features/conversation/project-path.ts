// 任务的项目目录：只用来把工具参数里的绝对路径换成相对路径（主进程再校验一次）。listProjects 结果按进程缓存。
import type { ProjectId } from "../../../../shared/ipc.ts";
import { useEffect, useState } from "react";

let cache: Promise<Map<string, string>> | null = null;

function projectPaths(): Promise<Map<string, string>> {
  cache ??= window.studio
    .listProjects()
    .then((projects) => new Map(projects.map((project) => [project.id, project.path])));
  return cache;
}

export function useProjectPath(projectId: ProjectId | undefined): string | null {
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    if (projectId === undefined) return;
    void projectPaths().then((paths) => {
      const found = paths.get(projectId);
      if (found === undefined) cache = null; // 项目是后来加的：下次重新取
      setPath(found ?? null);
    });
  }, [projectId]);
  return path;
}
