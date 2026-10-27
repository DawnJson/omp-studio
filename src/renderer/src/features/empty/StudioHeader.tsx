// 过程区顶部的标题块（TspView，跟着对话一起滚走）：和新任务页的标题同一个排法——π | 项目文件夹名，完整路径在名字下面一行。
// TSP 里 omp 自己的欢迎块（omp.welcome）不画，由它顶替。
import type { ReactNode } from "react";
import { EmptyMark } from "./EmptyMark.tsx";
import { PathLabel } from "./ProjectLabel.tsx";
import "./empty.css";

interface StudioHeaderProps {
  /** 任务的工作目录：标题写它的文件夹名，下面一行写完整路径。 */
  path?: string;
  children?: ReactNode;
}

/** 路径最后一段（Windows 和 POSIX 分隔符都认，忽略末尾的分隔符）。 */
function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return at >= 0 ? trimmed.slice(at + 1) : trimmed;
}

export function StudioHeader({ path, children }: StudioHeaderProps) {
  const hasPath = path !== undefined && path !== "";
  return (
    <div className="studio-head" data-testid="studio-header">
      <EmptyMark />
      {hasPath && (
        <>
          <div className="studio-head-name" title={path}>
            {folderName(path) || path}
          </div>
          <PathLabel path={path} testId="studio-header-folder" />
        </>
      )}
      {children}
    </div>
  );
}
