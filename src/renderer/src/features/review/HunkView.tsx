// 一个 hunk：头部（@@ 行 + 暂存/取消暂存/丢弃）、统一或并排的行、行下面的评论线程。
// 行号就是"评论"按钮：点一下对这行写评论，Shift 点击把范围扩到这一行（只能在旧/新同一侧内）。
import { Fragment, useMemo, type MouseEvent, type ReactNode } from "react";
import { toSideBySide, type GitDiffArea, type GitDiffHunk, type GitDiffLine } from "../../../../shared/git.ts";
import {
  changeBlockStarts,
  commentCovers,
  commentsEndingAt,
  inSelection,
  lineRef,
  type LineRef,
  type LineSelection,
  type QueuedComment,
} from "../../../../shared/ui/review-model.ts";
import { useT } from "../../i18n/use-t.ts";
import { Plus } from "../../icons.tsx";
import type { HighlightToken } from "../../markdown/highlight-tokens.ts";
import { Button } from "../../ui/controls.tsx";
import { CommentBox, CommentCard } from "./CommentBox.tsx";
import { displayText, useHunkTokens, type LineTokens } from "./use-hunk-tokens.ts";

/** 评论交互：FileDiffView 持有状态，HunkView 只负责把它们画在对应的行下面。 */
export interface CommentCtx {
  /** 这个文件、这一侧的评论。 */
  comments: readonly QueuedComment[];
  /** 正在写的新评论的选区。 */
  draft: LineSelection | null;
  editingId: string | null;
  pick(ref: LineRef, extend: boolean): void;
  submitDraft(body: string): void;
  cancelDraft(): void;
  edit(id: string): void;
  saveEdit(id: string, body: string): void;
  cancelEdit(): void;
  remove(id: string): void;
}

export interface HunkActions {
  stage?: () => void;
  unstage?: () => void;
  discard?: () => void;
  /** 忽略空白时 hunk 级操作不可用（界面上的块不是能 `git apply` 的块）。 */
  blocked?: boolean | undefined;
  /** 有选中行时头部多出来的按行操作。 */
  lines?: {
    count: number;
    stage?: () => void;
    unstage?: () => void;
    discard?: () => void;
    clear: () => void;
  };
}

/** 按行选择：selected 是选中的行下标；点击（Shift 点击扩展）改选择。 */
export interface PickCtx {
  selected: ReadonlySet<number>;
  onPick(index: number, extend: boolean): void;
}

/**
 * 点击行 → 选择；点行号（写评论）和正在拖选文字时不当作点击。Shift 点击是明确的"扩展选择"：
 * 按下时拦掉浏览器自己的文字选区扩展（否则它会在两次点击之间选出一段文字），点击时也不看文字选区。
 */
function pickProps(pick: PickCtx | null, index: number | undefined) {
  if (pick === null || index === undefined) return {};
  return {
    onMouseDown: (event: MouseEvent) => {
      if (event.shiftKey) event.preventDefault();
    },
    onClick: (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(".rv-no-btn")) return;
      if (!event.shiftKey && window.getSelection()?.toString()) return;
      pick.onPick(index, event.shiftKey);
    },
  };
}

/** "文件"视图里的改动块：base = 这个 hunk 之前已有几块，active = 当前块（n / p）的序号。 */
export interface BlockCtx {
  base: number;
  active: number | null;
}

const SIGN: Record<GitDiffLine["kind"], string> = { context: "", add: "+", del: "−" };

function Code({ text, tokens }: { text: string; tokens: HighlightToken[] | null }): ReactNode {
  if (tokens === null) return displayText(text);
  return tokens.map((token, index) => (
    <span
      key={index}
      style={{
        color: token.color,
        fontStyle: token.italic ? "italic" : undefined,
        fontWeight: token.bold ? "var(--fw-strong)" : undefined,
      }}
    >
      {token.text}
    </span>
  ));
}

function Gutter({ line, target, ctx }: { line: number | null; target: LineRef | null; ctx: CommentCtx }) {
  const t = useT();
  if (line === null) return <span className="rv-no" />;
  if (target === null) return <span className="rv-no">{line}</span>;
  return (
    <button
      type="button"
      className="rv-no rv-no-btn"
      data-testid="line-comment"
      data-line={line}
      data-side={target.side}
      aria-label={t("review.addCommentAt", { line })}
      title={t("review.addCommentAt", { line })}
      onClick={(event) => ctx.pick(target, event.shiftKey)}
    >
      <Plus size={12} className="rv-no-plus" />
      <span className="rv-no-n">{line}</span>
    </button>
  );
}

function marks(
  ref: LineRef | null,
  ctx: CommentCtx,
  file: string,
  area: GitDiffArea,
): { selected: boolean; commented: boolean } {
  if (ref === null) return { selected: false, commented: false };
  return {
    selected: ctx.draft !== null && inSelection(ctx.draft, ref),
    commented: ctx.comments.some((comment) => commentCovers(comment, file, area, ref)),
  };
}

function Thread({ refs, file, area, ctx }: { refs: LineRef[]; file: string; area: GitDiffArea; ctx: CommentCtx }) {
  const t = useT();
  const items = refs.flatMap((ref) => commentsEndingAt(ctx.comments, file, area, ref));
  const draft = refs.find((ref) => ctx.draft !== null && ctx.draft.side === ref.side && ctx.draft.end === ref.line);
  if (items.length === 0 && draft === undefined) return null;
  return (
    <div className="rv-thread" data-testid="comment-thread">
      {items.map((comment) =>
        ctx.editingId === comment.id ? (
          <CommentBox
            key={comment.id}
            initial={comment.body}
            submitLabel={t("review.commentSave")}
            startLine={comment.startLine}
            endLine={comment.endLine}
            onSubmit={(body) => ctx.saveEdit(comment.id, body)}
            onCancel={ctx.cancelEdit}
          />
        ) : (
          <CommentCard
            key={comment.id}
            id={comment.id}
            body={comment.body}
            old={comment.side === "old"}
            onEdit={() => ctx.edit(comment.id)}
            onDelete={() => ctx.remove(comment.id)}
          />
        ),
      )}
      {draft !== undefined && ctx.draft !== null && (
        <CommentBox
          initial=""
          submitLabel={t("review.commentAdd")}
          startLine={ctx.draft.start}
          endLine={ctx.draft.end}
          onSubmit={ctx.submitDraft}
          onCancel={ctx.cancelDraft}
        />
      )}
    </div>
  );
}

function UnifiedRows({
  hunk,
  tokens,
  file,
  area,
  ctx,
  blocks,
  pick,
}: {
  hunk: GitDiffHunk;
  tokens: LineTokens | null;
  file: string;
  area: GitDiffArea;
  ctx: CommentCtx;
  blocks: BlockCtx | null;
  pick: PickCtx | null;
}) {
  const starts = useMemo(() => changeBlockStarts(hunk.lines.map((line) => line.kind !== "context")), [hunk]);
  return (
    <>
      {hunk.lines.map((line, index) => {
        const ref = lineRef(line);
        const { selected, commented } = marks(ref, ctx, file, area);
        const block = blocks === null || starts[index] === null ? null : blocks.base + (starts[index] ?? 0);
        return (
          <Fragment key={index}>
            <div
              className="rv-row"
              data-kind={line.kind}
              data-selected={selected || undefined}
              data-commented={commented || undefined}
              data-block={block ?? undefined}
              data-block-active={block !== null && block === blocks?.active ? true : undefined}
              data-pickable={(pick !== null && line.kind !== "context") || undefined}
              data-picked={pick?.selected.has(index) || undefined}
              data-idx={index}
              {...pickProps(line.kind === "context" ? null : pick, index)}
            >
              {/* 一列行号：删除行写旧行号（评论旧版本），其余写新行号。 */}
              <Gutter line={ref?.line ?? null} target={ref} ctx={ctx} />
              <span className="rv-sign" aria-hidden="true">
                {SIGN[line.kind]}
              </span>
              <code className="rv-code">
                <Code text={line.text} tokens={tokens?.[index] ?? null} />
              </code>
            </div>
            <Thread refs={ref ? [ref] : []} file={file} area={area} ctx={ctx} />
          </Fragment>
        );
      })}
    </>
  );
}

function SplitRows({
  hunk,
  tokens,
  file,
  area,
  ctx,
  blocks,
  pick,
}: {
  hunk: GitDiffHunk;
  tokens: LineTokens | null;
  file: string;
  area: GitDiffArea;
  ctx: CommentCtx;
  blocks: BlockCtx | null;
  pick: PickCtx | null;
}) {
  const positions = useMemo(() => new Map(hunk.lines.map((line, at) => [line, at])), [hunk]);
  const rows = useMemo(() => toSideBySide(hunk), [hunk]);
  const starts = useMemo(() => changeBlockStarts(rows.map((row) => row.left !== row.right)), [rows]);
  const tokenOf = (line: GitDiffLine | null) => {
    const at = line === null ? undefined : positions.get(line);
    return at === undefined ? null : (tokens?.[at] ?? null);
  };
  // 只有改动行能选：左边的删除、右边的新增（上下文行左右各画一次，不选）。
  const pickable = (line: GitDiffLine | null) =>
    (pick !== null && line !== null && line.kind !== "context") || undefined;
  const picked = (line: GitDiffLine | null) => {
    const at = line === null ? undefined : positions.get(line);
    return (at !== undefined && pick?.selected.has(at)) || undefined;
  };
  return (
    <>
      {rows.map((row, index) => {
        const leftRef = row.left?.kind === "del" ? lineRef(row.left) : null;
        const rightRef = row.right ? lineRef(row.right) : null;
        const left = marks(leftRef, ctx, file, area);
        const right = marks(rightRef, ctx, file, area);
        const block = blocks === null || starts[index] === null ? null : blocks.base + (starts[index] ?? 0);
        return (
          <Fragment key={index}>
            <div
              className="rv-row rv-row-split"
              data-block={block ?? undefined}
              data-block-active={block !== null && block === blocks?.active ? true : undefined}
            >
              <div
                className="rv-half"
                data-kind={row.left?.kind ?? "empty"}
                data-selected={left.selected || undefined}
                data-commented={left.commented || undefined}
                data-pickable={pickable(row.left)}
                data-picked={picked(row.left)}
                {...pickProps(row.left?.kind === "del" ? pick : null, row.left ? positions.get(row.left) : undefined)}
              >
                <Gutter line={row.left?.oldNo ?? null} target={leftRef} ctx={ctx} />
                <code className="rv-code">{row.left && <Code text={row.left.text} tokens={tokenOf(row.left)} />}</code>
              </div>
              <div
                className="rv-half"
                data-kind={row.right?.kind ?? "empty"}
                data-selected={right.selected || undefined}
                data-commented={right.commented || undefined}
                data-pickable={pickable(row.right)}
                data-picked={picked(row.right)}
                {...pickProps(
                  row.right?.kind === "add" ? pick : null,
                  row.right ? positions.get(row.right) : undefined,
                )}
              >
                <Gutter line={row.right?.newNo ?? null} target={rightRef} ctx={ctx} />
                <code className="rv-code">
                  {row.right && <Code text={row.right.text} tokens={tokenOf(row.right)} />}
                </code>
              </div>
            </div>
            <Thread refs={[rightRef, leftRef].filter((ref) => ref !== null)} file={file} area={area} ctx={ctx} />
          </Fragment>
        );
      })}
    </>
  );
}

export function HunkView({
  file,
  area,
  hunk,
  index,
  mode,
  wrap,
  active,
  blocks,
  lang,
  ctx,
  actions,
  pick,
}: {
  file: string;
  area: GitDiffArea;
  hunk: GitDiffHunk;
  index: number;
  mode: "unified" | "split";
  wrap: boolean;
  active: boolean;
  /** "文件"视图（整个文件连成一个 hunk）：不画 @@ 头和 hunk 级操作，n / p 在改动块之间走；改动块视图是 null。 */
  blocks: BlockCtx | null;
  lang: string | null;
  ctx: CommentCtx;
  actions: HunkActions;
  /** 按行选择；null = 这个视图 / 这一侧不能按行操作。 */
  pick: PickCtx | null;
}) {
  const t = useT();
  const tokens = useHunkTokens(hunk, lang);
  const section = hunk.header.replace(/^@@[^@]*@@\s?/, "");
  const blockedTip = actions.blocked ? t("review.ignoreSpaceBlocked") : undefined;
  return (
    <section
      className="rv-hunk"
      data-testid="hunk"
      data-hunk={index}
      data-active={active || undefined}
      data-scope={blocks === null ? "hunks" : "file"}
      data-wrap={wrap ? "on" : "off"}
    >
      {blocks === null && (
        <header className="rv-hunk-head">
          <code className="rv-hunk-range" title={pick === null ? undefined : t("review.pickHint")}>
            @@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
          </code>
          {section !== "" && <span className="rv-hunk-section">{section}</span>}
          {actions.lines && (
            <span className="rv-lines-bar" data-testid="lines-bar">
              <span className="rv-lines-count" data-testid="lines-count">
                {t("review.linesSelected", { count: actions.lines.count })}
              </span>
              {actions.lines.stage && (
                <Button size="sm" variant="primary" testId="lines-stage" onClick={actions.lines.stage}>
                  {t("review.stageLines")}
                </Button>
              )}
              {actions.lines.unstage && (
                <Button size="sm" variant="primary" testId="lines-unstage" onClick={actions.lines.unstage}>
                  {t("review.unstageLines")}
                </Button>
              )}
              {actions.lines.discard && (
                <Button size="sm" variant="danger" testId="lines-discard" onClick={actions.lines.discard}>
                  {t("review.discardLines")}
                </Button>
              )}
              <Button size="sm" variant="quiet" testId="lines-clear" onClick={actions.lines.clear}>
                {t("review.clearLines")}
              </Button>
            </span>
          )}
          <span className="rv-hunk-actions">
            {actions.stage && (
              <Button
                size="sm"
                testId="hunk-stage"
                disabled={actions.blocked}
                title={blockedTip}
                onClick={actions.stage}
              >
                {t("review.stage")}
              </Button>
            )}
            {actions.unstage && (
              <Button
                size="sm"
                testId="hunk-unstage"
                disabled={actions.blocked}
                title={blockedTip}
                onClick={actions.unstage}
              >
                {t("review.unstage")}
              </Button>
            )}
            {actions.discard && (
              <Button
                size="sm"
                variant="danger"
                testId="hunk-discard"
                disabled={actions.blocked}
                title={blockedTip}
                onClick={actions.discard}
              >
                {t("review.discard")}
              </Button>
            )}
          </span>
        </header>
      )}
      <div className="rv-lines" data-mode={mode}>
        {mode === "unified" ? (
          <UnifiedRows hunk={hunk} tokens={tokens} file={file} area={area} ctx={ctx} blocks={blocks} pick={pick} />
        ) : (
          <SplitRows hunk={hunk} tokens={tokens} file={file} area={area} ctx={ctx} blocks={blocks} pick={pick} />
        )}
      </div>
    </section>
  );
}
