// 待发送的评论：按文件和行排序，可改、可删、点标题跳到对应文件。
import { rangeText, sortComments, type QueuedComment } from "../../../../shared/ui/review-model.ts";
import { useT } from "../../i18n/use-t.ts";
import { removeComment, updateComment } from "../../store/review-store.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { useState } from "react";
import { CommentBox } from "./CommentBox.tsx";

export function CommentQueue({
  taskId,
  comments,
  onJump,
}: {
  taskId: TaskId;
  comments: readonly QueuedComment[];
  onJump(comment: QueuedComment): void;
}) {
  const t = useT();
  const [editingId, setEditingId] = useState<string | null>(null);
  if (comments.length === 0) return <p className="rv-empty">{t("review.queueEmpty")}</p>;
  return (
    <ol className="rv-queue" aria-label={t("review.queue")} data-testid="comment-queue">
      {sortComments(comments).map((comment) => (
        <li key={comment.id} className="rv-queue-item" data-testid="queued-comment">
          <button type="button" className="rv-queue-ref" onClick={() => onJump(comment)} title={comment.file}>
            <span className="rv-queue-file">{comment.file}</span>
            <span className="rv-queue-range">:{rangeText(comment.startLine, comment.endLine)}</span>
            {comment.side === "old" && <span className="rv-tag">{t("review.commentOld")}</span>}
          </button>
          {editingId === comment.id ? (
            <CommentBox
              initial={comment.body}
              submitLabel={t("review.commentSave")}
              startLine={comment.startLine}
              endLine={comment.endLine}
              onSubmit={(body) => {
                updateComment(taskId, comment.id, body.trim());
                setEditingId(null);
              }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <>
              <p className="rv-queue-body">{comment.body}</p>
              <div className="rv-card-actions">
                <button type="button" className="rv-btn rv-btn-text" onClick={() => setEditingId(comment.id)}>
                  {t("review.edit")}
                </button>
                <button
                  type="button"
                  className="rv-btn rv-btn-text"
                  data-testid="queued-delete"
                  onClick={() => removeComment(taskId, comment.id)}
                >
                  {t("review.delete")}
                </button>
              </div>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}
