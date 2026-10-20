// 对话流里不属于消息的几类内容：提示、命令输出、压缩状态、模型错误（左 2px 红线 + 浅红底，不用大块红色）。
import type { ReactNode } from "react";
import type { PromptError } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { showView } from "../../store/index.ts";
import { reportError } from "../../ui/errors.ts";
import type { Extra } from "./model.ts";
import { ShellBlock } from "./ShellBlock.tsx";

/** 命令输出里的 http(s) 链接（如 /stats 的本地面板）；句末标点不算链接的一部分。 */
const urlPattern = /https?:\/\/[^\s<>"'`]+/g;

function linkify(text: string, open: (url: string) => void): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(urlPattern)) {
    const url = match[0].replace(/[.,;:!?)\]}]+$/, "");
    const start = match.index;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <a
        key={start}
        href={url}
        onClick={(event) => {
          event.preventDefault();
          open(url);
        }}
      >
        {url}
      </a>,
    );
    last = start + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function ModelError({
  message,
  error,
  onRetry,
}: {
  message: string;
  error: PromptError | null;
  /** 只有最近一条可重试的错误、且任务空闲时才传。 */
  onRetry: (() => void) | null;
}) {
  const t = useT();
  const unauthenticated = error?.httpStatus === 401 || error?.httpStatus === 403;
  return (
    <div className="inline-error" role="alert" data-testid="model-error">
      <span className="inline-error-text">{t("error.model", { message })}</span>
      {unauthenticated && (
        <button type="button" className="inline-error-action" onClick={() => showView("settings")}>
          {t("error.goSignIn")}
        </button>
      )}
      {onRetry !== null && (
        <button type="button" className="inline-error-action" data-testid="model-error-retry" onClick={onRetry}>
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}

export function ExtraView({ extra, taskId, retryable }: { extra: Extra; taskId: TaskId; retryable: boolean }) {
  const t = useT();
  switch (extra.kind) {
    case "notice":
      return (
        <p className="note" data-level={extra.level}>
          {extra.message}
        </p>
      );
    case "command_output":
      return (
        <pre className="command-output" aria-label={t("conversation.commandOutput")}>
          {linkify(extra.text, (url) => {
            window.studio.openExternal(url).catch((error: unknown) => reportError(t, error));
          })}
        </pre>
      );
    case "file_mention":
      return (
        <p className="note file-mention" data-testid="file-mention" title={extra.paths.join("\n")}>
          {t("conversation.filesAttached", { files: extra.paths.join(", ") })}
        </p>
      );
    case "compaction":
      return extra.phase === "end" ? (
        <p className="note" data-level="info">
          {t("process.compacted")}
        </p>
      ) : null;
    case "retry":
      return null;
    case "prompt_error": {
      const retry =
        retryable && extra.error?.retryable === true
          ? () => {
              window.studio
                .sendPrompt(taskId, { text: "/retry", whenBusy: "steer" })
                .catch((error: unknown) => reportError(t, error, t("msg.sendFailed")));
            }
          : null;
      return <ModelError message={extra.error?.message ?? ""} error={extra.error} onRetry={retry} />;
    }
    case "model_error":
      return <ModelError message={extra.message} error={null} onRetry={null} />;
    case "shell":
      return <ShellBlock extra={extra} />;
  }
}
