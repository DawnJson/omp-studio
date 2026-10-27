// studio 自己的标题块：像素标志 + 版本号，可选地带上文件夹路径。TSP 过程区顶部（TspView，compact 小一号，跟着对话一起滚走）用；
// TSP 里 omp 自己的欢迎块（omp.welcome）不画，由它顶替。新任务页不用它（只画 π，见 EmptyMark）。
import type { ReactNode } from "react";
import { useAppInfo } from "../../store/index.ts";
import { PixelLogo } from "../../ui/PixelLogo.tsx";
import { PathLabel } from "./ProjectLabel.tsx";
import "./empty.css";

interface StudioHeaderProps {
  /** 给了就在标志下面显示这个文件夹路径（任务的工作目录）。 */
  path?: string;
  compact?: boolean;
  children?: ReactNode;
}

const COMPACT_UNIT = 4;

export function StudioHeader({ path, compact = false, children }: StudioHeaderProps) {
  const version = useAppInfo()?.version ?? null;
  return (
    <div className="empty-hero" data-testid="studio-header" data-compact={compact ? "" : undefined}>
      <PixelLogo version={version} {...(compact ? { unit: COMPACT_UNIT } : {})} />
      {path !== undefined && path !== "" && <PathLabel path={path} testId="studio-header-folder" />}
      {children}
    </div>
  );
}
