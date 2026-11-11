// 回答里的本地图片（`![alt](路径)`）：读到了就显示图，点了在右侧预览打开（那里能缩放）；读不到（任务目录外、不存在、
// 不是图片、太大）或还在读时，显示成带图片图标的文件链接，悬停看完整路径，点了同样在右侧预览打开。
// 读由调用方给的 load 经主进程完成（render.ts 不碰磁盘）；路径变了才重读，流式输出时同一张图不会反复读。
import { useEffect, useState, type MouseEvent } from "react";
import { ImageIcon } from "../icons.tsx";

/** markdown-it 把路径里的空格、中文、`\` 编成 %XX：悬停提示和链接文字用解码后的原样路径。 */
function decodePath(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

/** 路径最后一段（说明文字为空时当链接文字）。 */
function baseName(path: string): string {
  return path.split(/[\\/]/).findLast((part) => part !== "") ?? path;
}

export function LocalImage({
  href,
  alt,
  load,
  open,
}: {
  href: string;
  alt: string;
  load: (href: string) => Promise<string | null>;
  open: (href: string) => void;
}) {
  const [loaded, setLoaded] = useState<{ href: string; src: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    load(href).then(
      (src) => {
        if (!cancelled) setLoaded({ href, src });
      },
      // 任务目录外、主进程拒绝：这是"不能显示"，不是故障，显示成链接即可（点开时预览面板会说明原因）。
      () => {
        if (!cancelled) setLoaded({ href, src: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [href, load]);
  const onClick = (event: MouseEvent) => {
    event.preventDefault();
    open(href);
  };
  const src = loaded?.href === href ? loaded.src : null;
  const shown = decodePath(href);
  if (src !== null) {
    return (
      <a href={href} title={shown} className="md-image-frame" onClick={onClick} data-testid="md-local-image">
        <img src={src} alt={alt} className="md-image" />
      </a>
    );
  }
  return (
    <a href={href} title={shown} className="md-link md-image-link" onClick={onClick} data-testid="md-image-link">
      <ImageIcon size={14} />
      {alt || baseName(shown)}
    </a>
  );
}
