// 分组标题后面跟一个 ⓘ：工具、MCP、记忆这几节的补充说明放进 ⓘ，不在标题下面另占一行灰字
// （2026-10-29 审计 SET-18，仓库规则：界面不放说明文字）。
import type { ReactNode } from "react";
import { InfoTip } from "../../ui/InfoTip.tsx";

export function TitleTip({ title, tip }: { title: ReactNode; tip: ReactNode }) {
  return (
    <>
      <span className="ui-info-lead">{title}</span>
      <InfoTip>{tip}</InfoTip>
    </>
  );
}
