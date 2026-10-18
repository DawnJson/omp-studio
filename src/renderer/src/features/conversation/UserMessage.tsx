// 用户消息（spec 4.8）：左对齐、--bg-raised 块；>12 行折叠成前 8 行 + 渐隐；hover 出现"复制"。
import { reportError } from "../../ui/errors.ts";
import { memo, useState } from "react";
import { useT } from "../../i18n/use-t.ts";
import type { UserBubble } from "./model.ts";

const COLLAPSE_OVER = 12;
const COLLAPSED_LINES = 8;

export const UserMessage = memo(function UserMessage({ user }: { user: UserBubble }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const lines = user.text.split("\n");
  const long = lines.length > COLLAPSE_OVER;
  const text = long && !expanded ? lines.slice(0, COLLAPSED_LINES).join("\n") : user.text;

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
      <div className="user-bubble" data-collapsed={(long && !expanded) || undefined}>
        <div className="user-text">{text}</div>
        {long && !expanded && (
          <button type="button" className="user-expand" onClick={() => setExpanded(true)}>
            {t("common.expand")}
          </button>
        )}
      </div>
      <button type="button" className="hover-action user-copy" onClick={copy}>
        {copied ? t("common.copied") : t("common.copy")}
      </button>
    </div>
  );
});
