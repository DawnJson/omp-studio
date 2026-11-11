// 文件 / 文件夹按类型显示的彩色图标(文件面板的树、预览页标题、输入框的文件附件、工具里的文件胶囊)。
// 图形拷自 Material Icon Theme(material-icon-theme 5.16.0 的 icons/*.svg,MIT,https://github.com/material-extensions/vscode-material-icon-theme;
// 许可证随包分发:file-icons/LICENSE.txt → 安装目录 resources/licenses/)。只拷了 file-icon-name.ts 三张表用到的图;
// 要加类型:从同一个包的 dist/material-icons.json 查图名,把 svg 拷进 file-icons/ 再加进 file-icon-name.ts 的表里。
// 用 <img> 画(SVG 当图片加载,不执行脚本、不进 DOM),颜色是图自带的,不跟主题变。
import { fileIconName } from "./file-icon-name.ts";

const urls = import.meta.glob<string>("./file-icons/*.svg", { query: "?url", import: "default", eager: true });

export function FileTypeIcon({
  name,
  kind = "file",
  open = false,
  size = 16,
}: {
  name: string;
  kind?: "file" | "dir";
  open?: boolean;
  size?: number;
}) {
  const icon = fileIconName(name, kind, open);
  return (
    <img
      className="file-type-icon"
      src={urls[`./file-icons/${icon}.svg`]}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      data-icon={icon}
    />
  );
}
