// TSP 的命名图标组件；画法和名字解析在 icon-names.ts。
import { memo } from "react";
import { PATHS, resolveIconName } from "./icon-names.ts";

interface TspIconProps {
  name: string | undefined;
  size?: number;
}

/** 一个命名图标；未知名字返回 null（画不出来，也不占位）。 */
export const TspIcon = memo(function TspIcon({ name, size = 14 }: TspIconProps) {
  const resolved = resolveIconName(name);
  if (resolved === null) return null;
  return (
    <svg
      className="tsp-ico"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="var(--icon-stroke)"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[resolved]!.map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  );
});
