// 设置页里放在某个 omp 设置分组最前面的卡片（spec §4.19）：工具与权限 → 可用工具；上下文与记忆 → 记忆；集成 → MCP 服务器 + SSH 主机。
import type { ReactNode } from "react";
import type { ConfigGroup } from "../../../../shared/ui/config-groups.ts";
import { McpCard } from "./McpCard.tsx";
import { MemoryCard } from "./MemoryCard.tsx";
import { SshCard } from "./SshCard.tsx";
import { ToolsCard } from "./ToolsCard.tsx";
import "./integrations.css";

function cards(group: ConfigGroup): ReactNode {
  switch (group) {
    case "tools":
      return <ToolsCard />;
    case "context":
      return <MemoryCard />;
    case "integrations":
      return (
        <>
          <McpCard />
          <SshCard />
        </>
      );
    default:
      return null;
  }
}

export function IntegrationCards({ group }: { group: ConfigGroup }) {
  const content = cards(group);
  return content === null ? null : <div className="ig-cards">{content}</div>;
}
