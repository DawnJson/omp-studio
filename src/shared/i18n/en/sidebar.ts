import type { MessageEntry } from "../index.ts";
import type { sidebar as zhCN } from "../zh-CN/sidebar.ts";

export const sidebar = {
  newTask: "New task",
  waitingOne: "1 task waiting for you · {project}",
  waitingMany: "{n} tasks waiting for you",
  empty: "No tasks yet",
  settings: "Settings",
  palette: "Command palette",
  newInProject: "New task in this project",
  label: "Tasks",
  projectMenu: "Project menu",
  addProject: "Add project",
  showMore: "Show {n} more",
  toggleProject: "Expand or collapse {project}",
  waitingHere: "A task is waiting for you",
  loadFailed: "Could not load tasks: {message}",
  loading: "Loading…",
  projectsFailed: "Could not load projects: {message}",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
