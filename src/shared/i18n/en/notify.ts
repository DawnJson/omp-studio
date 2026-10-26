import type { MessageEntry } from "../index.ts";
import type { notify as zhCN } from "../zh-CN/notify.ts";

export const notify = {
  title: "{project} · {task}",
  "body.gate": "Needs your confirmation: {title}",
  "body.done": "Finished",
  "body.error": "Failed",
  "tray.name": "omp-studio",
  "tray.summary": "{running} running, {waiting} waiting for you",
  "tray.idle": "No tasks running",
  "tray.open": "Open omp-studio",
  "tray.quit": "Quit",
  "tray.task.running": "Running · {title}",
  "tray.task.waiting": "Waiting for you · {title}",
  "tray.stillRunning.title": "omp-studio is still running in the tray",
  "tray.stillRunning.body":
    "Closing the window does not stop your tasks. To quit, right-click the tray icon and choose “Quit”.",
  "tray.stillRunning.titleMac": "omp-studio is still running in the menu bar",
  "tray.stillRunning.bodyMac":
    "Closing the window does not stop your tasks. To quit, press ⌘Q or use the menu bar icon and choose “Quit”.",
  "tray.stillRunning.titleLinux": "omp-studio is still running in the background",
  "tray.stillRunning.bodyLinux":
    "Closing the window does not stop your tasks. To quit, press Ctrl+Q or choose “Quit” from the tray icon. Open omp-studio again to bring the window back.",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
