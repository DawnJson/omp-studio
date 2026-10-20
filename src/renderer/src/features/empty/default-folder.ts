// 默认文件夹：AppInfo.chatsDir（~/omp-studio/chats）。新任务不选项目时在这里运行，第一次发送时主进程才建目录、加项目；
// 之后它在项目列表里是普通项目，界面上一律叫"默认文件夹"，不露出 chats 这个目录名。
import type { Project } from "../../../../shared/ipc.ts";

function norm(value: string): string {
  return value
    .replace(/[\\/]+$/, "")
    .replaceAll("\\", "/")
    .toLowerCase();
}

export function isDefaultFolder(project: Project, chatsDir: string | null): boolean {
  return chatsDir !== null && norm(project.path) === norm(chatsDir);
}
