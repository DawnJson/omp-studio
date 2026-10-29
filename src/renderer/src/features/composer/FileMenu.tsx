// `@` 文件菜单：和斜杠菜单同一套外观，每行一个相对路径（目录部分 --text-3，文件名正常色）。键盘由 Composer 处理。
import { useEffect, useRef } from "react";
import { useT } from "../../i18n/use-t.ts";
import { usePresence } from "../../ui/presence.ts";

interface FileMenuProps {
  id: string;
  open: boolean;
  files: readonly string[];
  active: number;
  onHover(index: number): void;
  onPick(file: string): void;
}

export function FileMenu({ id, open, files: liveFiles, active, onHover, onPick }: FileMenuProps) {
  const t = useT();
  const listRef = useRef<HTMLDivElement>(null);
  const presence = usePresence(open);
  // 关闭放退出动画时沿用关闭前的文件列表。
  const heldRef = useRef(liveFiles);
  if (open) heldRef.current = liveFiles;
  const files = open ? liveFiles : heldRef.current;
  useEffect(() => {
    listRef.current?.querySelector(`[id="${id}-${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [id, active]);
  if (!presence.mounted) return null;
  return (
    <div
      className="slash file-menu"
      role="listbox"
      id={id}
      ref={listRef}
      aria-label={t("composer.fileRef")}
      data-testid="file-menu"
      {...presence.exitProps}
    >
      {files.map((file, index) => {
        const cut = file.lastIndexOf("/") + 1;
        return (
          <button
            key={file}
            id={`${id}-${index}`}
            type="button"
            role="option"
            aria-selected={index === active}
            className="slash-row"
            data-active={index === active || undefined}
            title={file}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onHover(index)}
            onClick={() => onPick(file)}
          >
            <span className="slash-name">{file.slice(cut)}</span>
            {cut > 0 && <span className="slash-desc">{file.slice(0, cut - 1)}</span>}
          </button>
        );
      })}
    </div>
  );
}
