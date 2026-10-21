// 一次性提示层：主进程的任务提示（目标完成）和"别的任务在等你确认"变成 toast；toast 叠放区在这里挂载。
import { Toasts } from "./Toasts.tsx";
import { useNeedsYouToasts, useTaskNotices } from "./use-task-notices.ts";
import "./dialogs.css";

export function NoticeLayer() {
  useTaskNotices();
  useNeedsYouToasts();
  return <Toasts />;
}
