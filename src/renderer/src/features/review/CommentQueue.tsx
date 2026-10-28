// 待发送的评论：工具条上"评论 N"按钮，点开是列表浮层（按文件和行排序），点一条跳到对应文件；评论本身只在 diff 里改 / 删。
import { useState } from "react";
import { rangeText, sortComments, type QueuedComment } from "../../../../shared/ui/review-model.ts";
import { useT } from "../../i18n/use-t.ts";
import { Comment } from "../../icons.tsx";
import { Badge, Button } from "../../ui/controls.tsx";
import { anchorBelow, Menu, type MenuAnchor } from "../../ui/Menu.tsx";

const NOTE_MAX = 80;

function preview(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > NOTE_MAX ? `${flat.slice(0, NOTE_MAX)}…` : flat;
}

export function CommentQueue({
  comments,
  onJump,
}: {
  comments: readonly QueuedComment[];
  onJump(comment: QueuedComment): void;
}) {
  const t = useT();
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const empty = comments.length === 0;
  return (
    <>
      <Button
        size="sm"
        icon={<Comment size={14} />}
        disabled={empty}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        data-testid="comment-queue-button"
        onClick={(event) => setMenu(menu !== null ? null : anchorBelow(event.currentTarget))}
      >
        {t("review.tabComments")}
        {!empty && (
          <Badge tone="accent" testId="comment-count">
            {comments.length}
          </Badge>
        )}
      </Button>
      {menu && !empty && (
        <Menu
          anchor={menu}
          label={t("review.queue")}
          testId="comment-queue"
          onClose={() => setMenu(null)}
          items={sortComments(comments).map((comment) => ({
            id: comment.id,
            label: `${comment.file}:${rangeText(comment.startLine, comment.endLine)}`,
            note:
              comment.side === "old" ? `${t("review.commentOld")} · ${preview(comment.body)}` : preview(comment.body),
            testId: "queued-comment",
            onSelect: () => onJump(comment),
          }))}
        />
      )}
    </>
  );
}
