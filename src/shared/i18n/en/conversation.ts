import type { MessageEntry } from "../index.ts";
import type { conversation as zhCN } from "../zh-CN/conversation.ts";

export const conversation = {
  imageAlt: "Image",
  commandOutput: "Command output",
  starting: "Starting omp…",
  filesAttached: "Attached files: {files}",
  todoTitle: "Progress",
  "todo.pending": "Pending",
  "todo.in_progress": "In progress",
  "todo.completed": "Completed",
  "todo.blocked": "Blocked",
  "todo.abandoned": "Abandoned",
  "shell.stop": "Stop",
  "shell.excludeUnsupported":
    "!! (keep out of the model context) is not supported over omp's RPC yet; use ! and the model will see the output, or run it in the terminal omp",
  "shell.busy":
    "A command or a turn is still running; wait for it to finish (Esc stops it) before running another !command",
  "shell.needsTask": "!commands run inside a task: send a first message to create one, then use !",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
