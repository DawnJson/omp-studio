// studio 自己的标题块：像素标志 + 版本号。TSP 过程区顶部（TspView，compact 小一号，跟着对话一起滚走）用；
// TSP 里 omp 自己的欢迎块（omp.welcome）不画，由它顶替。新任务页不用它（只画 π，见 EmptyMark）。
// 不写任务的文件夹：Composer 工具行的文件夹标签（composer-folder）一直写着（2026-10-29 仓库所有者：删掉重复的）。
import type { ReactNode } from "react";
import { useAppInfo } from "../../store/index.ts";
import { PixelLogo } from "../../ui/PixelLogo.tsx";
import "./empty.css";

interface StudioHeaderProps {
  compact?: boolean;
  children?: ReactNode;
}

const COMPACT_UNIT = 4;

export function StudioHeader({ compact = false, children }: StudioHeaderProps) {
  const version = useAppInfo()?.version ?? null;
  return (
    <div className="empty-hero" data-testid="studio-header" data-compact={compact ? "" : undefined}>
      <PixelLogo version={version} {...(compact ? { unit: COMPACT_UNIT } : {})} />
      {children}
    </div>
  );
}
