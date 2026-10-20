// 草稿要在哪个项目里开始：用户选的（工具行的项目按钮、侧栏项目旁的 ＋、打开文件夹）；
// 没选就是 null = 默认文件夹（AppInfo.chatsDir，发出第一条消息时才建目录、加项目）。
// 新任务（侧栏按钮、Ctrl N）一律回到默认文件夹，不沿用最近用过的项目。
import type { Project } from "../../../../shared/ipc.ts";
import { useProjects } from "../sidebar/projects-store.ts";
import { useDraftProjectId } from "./draft-project.ts";

export function useDraftProject(): Project | null {
  const projects = useProjects();
  const pickedId = useDraftProjectId();
  return projects.find((candidate) => candidate.id === pickedId) ?? null;
}
