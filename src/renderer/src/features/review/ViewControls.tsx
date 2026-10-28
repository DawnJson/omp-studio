// 评审头里的三组显示选项：统一 / 并排、改动块 / 整个文件、折行。选择存在 review-store（会话内记住），快捷键 V / F / W 与这里同一份状态。
// 宽窗口：两组分段（sm）+ 折行图标按钮（pressed）直接摆在工具条上；窗口窄于 1100 时收成一个"视图"菜单，工具条不会被裁掉。
import { useState, useSyncExternalStore } from "react";
import type { GitDiffContext } from "../../../../shared/git.ts";
import { useT } from "../../i18n/use-t.ts";
import { Sliders, Whitespace, Wrap } from "../../icons.tsx";
import { setReviewMode, setReviewScope, setReviewWrap } from "../../store/review-store.ts";
import { Button, IconButton, Segmented } from "../../ui/controls.tsx";
import { anchorBelow, Menu, type MenuAnchor, type MenuEntry } from "../../ui/Menu.tsx";

const narrowQuery = "(max-width: 1099px)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(narrowQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(narrowQuery).matches);
}

export function ViewControls({
  mode,
  scope,
  wrap,
  ignoreSpace,
  onIgnoreSpace,
}: {
  mode: "unified" | "split";
  scope: GitDiffContext;
  wrap: boolean;
  /** 忽略空白（`git diff -w`）：只影响显示；打开时 hunk / 行级暂存不可用。 */
  ignoreSpace: boolean;
  onIgnoreSpace(value: boolean): void;
}) {
  const t = useT();
  const narrow = useNarrow();
  const [menu, setMenu] = useState<MenuAnchor | null>(null);

  if (narrow) {
    const items: MenuEntry[] = [
      { kind: "label", id: "label-layout", label: t("review.layout") },
      {
        id: "unified",
        label: t("review.unified"),
        checked: mode === "unified",
        onSelect: () => setReviewMode("unified"),
      },
      { id: "split", label: t("review.split"), checked: mode === "split", onSelect: () => setReviewMode("split") },
      { kind: "separator", id: "sep-scope" },
      { kind: "label", id: "label-scope", label: t("review.scope") },
      {
        id: "hunks",
        label: t("review.scopeHunks"),
        checked: scope === "hunks",
        onSelect: () => setReviewScope("hunks"),
      },
      { id: "file", label: t("review.scopeFile"), checked: scope === "file", onSelect: () => setReviewScope("file") },
      { kind: "separator", id: "sep-wrap" },
      { id: "wrap", label: t("review.wrap"), checked: wrap, shortcut: "W", onSelect: () => setReviewWrap(!wrap) },
      {
        id: "ignore-space",
        label: t("review.ignoreSpace"),
        checked: ignoreSpace,
        onSelect: () => onIgnoreSpace(!ignoreSpace),
      },
    ];
    return (
      <>
        <Button
          size="sm"
          icon={<Sliders size={14} />}
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          data-testid="view-menu"
          onClick={(event) => setMenu(menu !== null ? null : anchorBelow(event.currentTarget))}
        >
          {t("review.view")}
        </Button>
        {menu && <Menu anchor={menu} items={items} label={t("review.view")} onClose={() => setMenu(null)} />}
      </>
    );
  }

  return (
    <>
      <Segmented
        size="sm"
        label={t("review.layout")}
        testId="mode"
        value={mode}
        onChange={setReviewMode}
        options={[
          { value: "unified", label: t("review.unified") },
          { value: "split", label: t("review.split") },
        ]}
      />
      <Segmented
        size="sm"
        label={t("review.scope")}
        testId="scope"
        value={scope}
        onChange={setReviewScope}
        options={[
          { value: "hunks", label: t("review.scopeHunks") },
          { value: "file", label: t("review.scopeFile") },
        ]}
      />
      <IconButton
        label={t("review.wrap")}
        tip={`${t("review.wrap")} (W)`}
        pressed={wrap}
        testId="wrap-toggle"
        onClick={() => setReviewWrap(!wrap)}
      >
        <Wrap size={14} />
      </IconButton>
      <IconButton
        label={t("review.ignoreSpace")}
        pressed={ignoreSpace}
        testId="ignore-space-toggle"
        onClick={() => onIgnoreSpace(!ignoreSpace)}
      >
        <Whitespace size={14} />
      </IconButton>
    </>
  );
}
