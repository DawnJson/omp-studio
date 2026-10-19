// `@` 文件菜单：和斜杠菜单同一套外观，每行一个相对路径（目录部分 --text-3，文件名正常色）。键盘由 Composer 处理。
import { useEffect, useRef } from "react";
import { useT } from "../../i18n/use-t.ts";

interface FileMenuProps {
  id: string;
  files: readonly string[];
  active: number;
  onHover(index: number): void;
  onPick(file: string): void;
}

export function FileMenu({ id, files, active, onHover, onPick }: FileMenuProps) {
  const t = useT();
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector(`[id="${id}-${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [id, active]);
  return (
    <div
      className="slash"
      role="listbox"
      id={id}
      ref={listRef}
      aria-label={t("composer.fileRef")}
      data-testid="file-menu"
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
