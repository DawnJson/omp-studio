// "范围"选择：用户范围（全局）或某个项目（在项目目录里读写项目层的配置）。集成页放在页头右侧，记忆放在设置行里。
import { useMemo } from "react";
import { useT } from "../../i18n/use-t.ts";
import { type Option, type ControlSize } from "../../ui/controls.tsx";
import { Select } from "../../ui/Select.tsx";
import { useProjects } from "../sidebar/projects-store.ts";
import type { ScopeKey } from "./integrations-store.ts";

export function ScopePicker({
  value,
  onChange,
  includeUser,
  labelledBy,
  label,
  size = "md",
  width,
  testId,
}: {
  value: ScopeKey;
  onChange(next: ScopeKey): void;
  /** 记忆只有项目范围，没有"用户"这一项。 */
  includeUser: boolean;
  /** 读屏名：指向页上的标签，或直接给文字。 */
  labelledBy?: string | undefined;
  label?: string | undefined;
  size?: ControlSize | undefined;
  width?: number | string | undefined;
  testId: string;
}) {
  const t = useT();
  const projects = useProjects();
  const options = useMemo(() => {
    const items: Option<string>[] = projects.map((project) => ({ value: project.id, label: project.name }));
    return includeUser ? [{ value: "user", label: t("integrations.scope.user") }, ...items] : items;
  }, [projects, includeUser, t]);
  // 选中的项目被移除了：不假装还选着它。
  const known = options.some((option) => option.value === value);
  const shown: Option<string>[] = known ? options : [{ value, label: value }, ...options];
  return (
    <Select
      value={value}
      options={shown}
      size={size}
      width={width}
      label={label}
      labelledBy={labelledBy}
      onChange={(next) => onChange(next as ScopeKey)}
      testId={testId}
    />
  );
}
