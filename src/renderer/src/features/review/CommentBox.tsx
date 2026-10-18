// 评论框：写新评论或改已有评论。Ctrl+Enter 提交，Esc 取消（不会连带退出评审）。
import { useState, type KeyboardEvent } from "react";
import { useT } from "../../i18n/use-t.ts";
import { rangeText } from "../../../../shared/ui/review-model.ts";

export function CommentBox({
  initial,
  submitLabel,
  startLine,
  endLine,
  onSubmit,
  onCancel,
}: {
  initial: string;
  submitLabel: string;
  startLine: number;
  endLine: number;
  onSubmit(body: string): void;
  onCancel(): void;
}) {
  const t = useT();
  const [body, setBody] = useState(initial);
  const empty = body.trim() === "";

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!empty) onSubmit(body);
    }
  };

  return (
    <div className="rv-box" data-testid="comment-box">
      <textarea
        className="rv-box-input"
        data-testid="comment-input"
        autoFocus
        rows={3}
        value={body}
        placeholder={t("review.commentPlaceholder")}
        aria-label={`${t("review.commentPlaceholder")} · ${rangeText(startLine, endLine)}`}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="rv-box-actions">
        <button type="button" className="rv-btn" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="rv-btn rv-btn-primary"
          data-testid="comment-submit"
          disabled={empty}
          onClick={() => onSubmit(body)}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

export function CommentCard({
  body,
  old,
  onEdit,
  onDelete,
}: {
  body: string;
  /** 评论的是旧版本的行。 */
  old: boolean;
  onEdit(): void;
  onDelete(): void;
}) {
  const t = useT();
  return (
    <div className="rv-card" data-testid="comment-card">
      <p className="rv-card-body">
        {old && <span className="rv-tag">{t("review.commentOld")}</span>}
        {body}
      </p>
      <div className="rv-card-actions">
        <button type="button" className="rv-btn rv-btn-text" onClick={onEdit}>
          {t("review.edit")}
        </button>
        <button type="button" className="rv-btn rv-btn-text" onClick={onDelete}>
          {t("review.delete")}
        </button>
      </div>
    </div>
  );
}
