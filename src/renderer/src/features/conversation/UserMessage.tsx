// 用户消息（spec 4.8）：左对齐、--bg-raised 块；>12 行折叠成前 8 行 + 渐隐；hover 出现"复制"。
import { reportError } from "../../ui/errors.ts";
import { memo, useState } from "react";
import { useT } from "../../i18n/use-t.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { useTaskIdle } from "../../store/tasks-store.ts";
import { isBtwRunning } from "../../../../shared/btw.ts";
import { useBtwRecords } from "../../store/btw-store.ts";
import { forkFromMessageReporting, useForkPending } from "./fork-actions.ts";
import { useShellRun } from "./shell-run-store.ts";
import type { UserBubble } from "./model.ts";
import { Reveal } from "../../ui/Reveal.tsx";

const COLLAPSE_OVER = 12;
const COLLAPSED_LINES = 8;

export const UserMessage = memo(function UserMessage({ user, taskId }: { user: UserBubble; taskId: TaskId }) {
  const t = useT();
  const idle = useTaskIdle(taskId);
  const shellRunning = useShellRun(taskId) !== null;
  const btwRunning = isBtwRunning(useBtwRecords(taskId));
  const forkPending = useForkPending(taskId);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const lines = user.text.split("\n");
  const long = lines.length > COLLAPSE_OVER;

  const copy = () => {
    navigator.clipboard.writeText(user.text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      (error: unknown) => reportError(t, error),
    );
  };

  return (
    <div className="user" data-anchor data-testid="user-message">
      {user.images.length > 0 && (
        <div className="user-images">
          {user.images.map((image, index) => (
            <img key={index} src={`data:${image.mimeType};base64,${image.data}`} alt={t("conversation.imageAlt")} />
          ))}
        </div>
      )}
      <div className="user-bubble" data-long={long || undefined} data-collapsed={(long && !expanded) || undefined}>
        <div className="user-text">{long ? lines.slice(0, COLLAPSED_LINES).join("\n") : user.text}</div>
        {long && (
          <Reveal open={expanded}>
            <div className="user-text">{lines.slice(COLLAPSED_LINES).join("\n")}</div>
          </Reveal>
        )}
        {long && (
          <button type="button" className="user-expand" onClick={() => setExpanded(true)}>
            {t("common.expand")}
          </button>
        )}
      </div>
      <div className="user-actions">
        <button type="button" className="hover-action" onClick={copy}>
          {copied ? t("common.copied") : t("common.copy")}
        </button>
        {idle && !shellRunning && !btwRunning && (
          <button
            type="button"
            className="hover-action"
            title={t("tree.forkTitle")}
            data-testid="user-fork"
            disabled={forkPending}
            onClick={() => void forkFromMessageReporting(taskId, user.key, t)}
          >
            {t("tree.fork")}
          </button>
        )}
      </div>
    </div>
  );
});
