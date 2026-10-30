import type { MessageEntry } from "../index.ts";
import type { error as zhCN } from "../zh-CN/error.ts";

export const error = {
  sessionBusy: "The task is still running. Try again when this turn ends.",
  composerUnavailable: "omp is waiting for your answer to its question or approval. Answer it first.",
  screenOpen: "An omp panel (such as the Agent Hub) is still open. Press Esc to close it before sending.",
  worktreeShared: "Other tasks, including archived forks, share this worktree, so it can’t be discarded.",
  forkNoMessage: "Couldn’t find a user message to fork from.",
  exited: "The omp process for this task exited (code {code}). Your session is saved.",
  exitedNoCode: "The omp process for this task exited. Your session is saved.",
  protocol: "Communication with omp failed and was disconnected. The version may be incompatible.",
  tooManyTasks: "Too many tasks are running. Stop or archive a few and try again.",
  worktreeMissing: "This task's worktree was deleted, so the record is view-only and the chat cannot continue.",
  model: "The model returned an error: {message}",
  modelUnavailable: "The model used by this session isn't available.",
  generic: "That didn’t work.",
  startFailed: "Couldn’t start omp.",
  executableBlocked: "Executable files aren’t opened directly. Reveal it in the folder instead.",
  notFound: "That task or project no longer exists.",
  statsSchema: "omp's statistics database doesn't look like the version this app expects, so it can't be read.",
  backdropTooLarge: "The image is larger than 20 MB. Pick a smaller one.",
  backdropNotImage:
    "This file isn’t a usable image (PNG, JPG, WebP, GIF, AVIF), or its content doesn’t match its extension.",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
