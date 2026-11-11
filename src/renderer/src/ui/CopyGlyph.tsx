// 复制按钮共用的反馈（spec §2.6"图标形变"）：复制成功后图标形变成对勾，停 COPIED_MS 再变回；读屏器经 aria-live 播报"已复制"。
// 图标本身就是确认，不另弹 toast。按钮外壳（IconButton、代码块头的小按钮、过程区的图标）由各处自己给。
import { useCallback, useEffect, useState } from "react";
import { useT } from "../i18n/use-t.ts";
import { reportErrorNow } from "./errors.ts";
import { MorphIcon, type MorphGlyph } from "./MorphIcon.tsx";
import { CHECK_GLYPH, COPY_GLYPH } from "./morph-glyphs.ts";

const COPIED_MS = 1200;

/** copy(text) 写系统剪贴板；成功后 copied 为 true，COPIED_MS 后变回（停留期间再复制从头计时）。失败弹错误 toast。 */
export function useCopy(): { copied: boolean; copy(text: string): void } {
  // 每次成功加一：连点时计时器跟着重来。
  const [stamp, setStamp] = useState(0);
  useEffect(() => {
    if (stamp === 0) return;
    const timer = setTimeout(() => setStamp(0), COPIED_MS);
    return () => clearTimeout(timer);
  }, [stamp]);
  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => setStamp((value) => value + 1), reportErrorNow);
  }, []);
  return { copied: stamp !== 0, copy };
}

/** 复制图标 ↔ 对勾，加一段只给读屏器的 aria-live 文字。idle 缺省是 src/icons.tsx 的复制图标（过程区用 TSP 自己那套）。 */
export function CopyGlyph({ copied, size, idle = COPY_GLYPH }: { copied: boolean; size: number; idle?: MorphGlyph }) {
  const t = useT();
  return (
    <>
      <MorphIcon glyph={copied ? CHECK_GLYPH : idle} size={size} />
      <span className="sr-only" aria-live="polite">
        {copied ? t("common.copied") : ""}
      </span>
    </>
  );
}
