import type { MessageEntry } from "../index.ts";

export const notify = {
  title: "{project} · {task}",
  "body.gate": "需要你确认：{title}",
  "body.done": "已完成",
  "body.error": "出错了",
  "tray.name": "omp-studio",
  "tray.summary": "{running} 个运行中，{waiting} 个等你确认",
  "tray.idle": "没有任务在运行",
  "tray.open": "打开 omp-studio",
  "tray.quit": "退出",
  "tray.task.running": "运行中 · {title}",
  "tray.task.waiting": "等你确认 · {title}",
  "tray.stillRunning.title": "omp-studio 仍在托盘运行",
  "tray.stillRunning.body": "关闭窗口不会中止任务。要退出，请右键托盘图标，选择“退出”。",
  "tray.stillRunning.titleMac": "omp-studio 仍在菜单栏运行",
  "tray.stillRunning.bodyMac": "关闭窗口不会中止任务。要退出，请按 ⌘Q，或点菜单栏图标选择“退出”。",
} satisfies Record<string, MessageEntry>;
