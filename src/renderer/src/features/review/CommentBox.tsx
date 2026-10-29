// 评论框：写新评论或改已有评论。Ctrl+Enter 提交，Esc 取消（不会连带退出评审）。
import { useState, type KeyboardEvent } from "react";
import { useT } from "../../i18n/use-t.ts";
import { Dots, Pencil, Trash } from "../../icons.tsx";
import { Button, IconButton, Textarea } from "../../ui/controls.tsx";
import { anchorBelowEnd, Menu, type MenuAnchor, type MenuEntry } from "../../ui/Menu.tsx";
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
      <Textarea
        testId="comment-input"
        autoFocus
        rows={3}
        value={body}
        placeholder={t("review.commentPlaceholder")}
        aria-label={`${t("review.commentPlaceholder")} · ${rangeText(startLine, endLine)}`}
        onChange={setBody}
        onKeyDown={onKeyDown}
      />
      <div className="rv-box-actions">
        <Button size="sm" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button variant="primary" size="sm" testId="comment-submit" disabled={empty} onClick={() => onSubmit(body)}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

/** 行内评论卡：编辑 / 删除收进右上角 ⋯ 菜单（删除红字放最后）。 */
export function CommentCard({
  id,
  body,
  old,
  onEdit,
  onDelete,
}: {
  /** 队列里点一条跳过来时按它找卡片。 */
  id: string;
  body: string;
  /** 评论的是旧版本的行。 */
  old: boolean;
  onEdit(): void;
  onDelete(): void;
}) {
  const t = useT();
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const items: MenuEntry[] = [
    { id: "edit", label: t("review.edit"), icon: <Pencil />, testId: "comment-edit", onSelect: onEdit },
    { kind: "separator", id: "sep" },
    {
      id: "delete",
      label: t("review.delete"),
      icon: <Trash />,
      tone: "danger",
      testId: "comment-delete",
      onSelect: onDelete,
    },
  ];
  return (
    <div className="rv-card" data-testid="comment-card" data-comment-id={id}>
      <p className="rv-card-body">
        {old && <span className="rv-tag">{t("review.commentOld")}</span>}
        {body}
      </p>
      <IconButton
        label={t("review.commentActions")}
        expanded={menu !== null}
        aria-haspopup="menu"
        testId="comment-more"
        onClick={(event) => setMenu(menu !== null ? null : anchorBelowEnd(event.currentTarget))}
      >
        <Dots size={14} />
      </IconButton>
      {menu && <Menu anchor={menu} items={items} label={t("review.commentActions")} onClose={() => setMenu(null)} />}
    </div>
  );
}
