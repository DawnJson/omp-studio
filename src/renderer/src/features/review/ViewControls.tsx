// 评审头里的三组显示选项：统一 / 并排、改动块 / 整个文件、折行。选择存在 review-store（会话内记住），快捷键 V / F / W 与这里同一份状态。
import type { GitDiffContext } from "../../../../shared/git.ts";
import { useT } from "../../i18n/use-t.ts";
import { setReviewMode, setReviewScope, setReviewWrap } from "../../store/review-store.ts";

export function ViewControls({
  mode,
  scope,
  wrap,
}: {
  mode: "unified" | "split";
  scope: GitDiffContext;
  wrap: boolean;
}) {
  const t = useT();
  return (
    <>
      <div className="rv-seg" role="group" aria-label={t("review.layout")}>
        <button
          type="button"
          className="rv-seg-btn"
          aria-pressed={mode === "unified"}
          data-testid="mode-unified"
          onClick={() => setReviewMode("unified")}
        >
          {t("review.unified")}
        </button>
        <button
          type="button"
          className="rv-seg-btn"
          aria-pressed={mode === "split"}
          data-testid="mode-split"
          onClick={() => setReviewMode("split")}
        >
          {t("review.split")}
        </button>
      </div>
      <div className="rv-seg" role="group" aria-label={t("review.scope")}>
        <button
          type="button"
          className="rv-seg-btn"
          aria-pressed={scope === "hunks"}
          data-testid="scope-hunks"
          onClick={() => setReviewScope("hunks")}
        >
          {t("review.scopeHunks")}
        </button>
        <button
          type="button"
          className="rv-seg-btn"
          aria-pressed={scope === "file"}
          data-testid="scope-file"
          onClick={() => setReviewScope("file")}
        >
          {t("review.scopeFile")}
        </button>
      </div>
      <button
        type="button"
        className="rv-btn rv-toggle"
        aria-pressed={wrap}
        data-testid="wrap-toggle"
        onClick={() => setReviewWrap(!wrap)}
      >
        {t("review.wrap")}
      </button>
    </>
  );
}
