import type { MessageEntry } from "../index.ts";
import type { error as zhCN } from "../zh-CN/error.ts";

export const error = {
  exited: "The omp process for this task exited (code {code}). Your session is saved.",
  exitedNoCode: "The omp process for this task exited. Your session is saved.",
  protocol: "Communication with omp failed and was disconnected. The version may be incompatible.",
  tooManyTasks: "Too many tasks are running. Stop or archive a few and try again.",
  worktreeMissing: "This task's worktree was deleted, so the record is view-only and the chat cannot continue.",
  reconnect: "Reconnect",
  copyDetails: "Copy details",
  model: "The model returned an error: {message}",
  goSignIn: "Go to sign-in",
  modelUnavailable: "The model used by this session isn't available.",
  generic: "That didn’t work.",
  startFailed: "Couldn’t start omp.",
  executableBlocked: "Executable files aren’t opened directly. Reveal it in the folder instead.",
  notFound: "That task or project no longer exists.",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
