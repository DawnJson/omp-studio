// 防的是：新加或改的中文文案又把 spec §1.2「开发者常用的英文术语」里保留英文的词译成中文（docs/design/spec.md 的术语行）。
// 只查字典里的文字，不查注释。"密钥"不在表里：spec 只要求 API key 叫 key，SSH 私钥、secrets 照常叫密钥。
import { expect, test } from "vitest";
import { zhCN } from "../src/shared/i18n/zh-CN/index.ts";

/** 中文译法 → 中文界面里应该写的英文。 */
const banned: Record<string, string> = {
  上下文: "context / Context",
  百万: "M（每 M token）",
  提供商: "provider / Provider",
  子代理: "subagent / Subagent",
  主代理: "main agent",
  工作树: "worktree / Worktree",
  钩子: "Hook",
  令牌: "token / Token",
  技能: "Skill",
  差异: "diff",
  系统提示: "system prompt",
  推理: "reasoning",
  视觉: "vision",
  作业: "后台任务（omp 的 job）",
};

/** 字典里所有文字（键路径 → 文字），嵌套的对象和数组展开。 */
function texts(value: unknown, at: string, out: [string, string][]): [string, string][] {
  if (typeof value === "string") out.push([at, value]);
  else if (Array.isArray(value)) value.forEach((item, index) => texts(item, `${at}[${index}]`, out));
  else if (typeof value === "object" && value !== null)
    for (const [key, item] of Object.entries(value)) texts(item, at === "" ? key : `${at}.${key}`, out);
  return out;
}

test("中文文案不把保留英文的术语译成中文", () => {
  const all = texts(zhCN, "", []);
  expect(all.length).toBeGreaterThan(100);
  const found = all.flatMap(([key, text]) =>
    Object.entries(banned)
      .filter(([term]) => text.includes(term))
      .map(([term, english]) => `${key}: "${term}" 应写成 ${english}：${text}`),
  );
  expect(found).toEqual([]);
});
