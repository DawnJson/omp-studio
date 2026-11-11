// 宠物的"魂"和说话：都是一次性的 `omp -p`，模型是 omp 的 tiny 角色、没配就 smol（chooseVoiceModel，docs/architecture/pet.md「说话」）。
// 发给模型的只有宠物自己的设定（物种、属性、名字、性格）和事件：任务状态 + 任务标题，不带对话内容（仓库所有者 2026-11-11 定）。
// 不带工具、会话、AGENTS.md（enhanceArgs）；文字走 stdin。失败只记日志、返回 null：宠物照样在，只是不说话 / 先没有名字。
import type { Locale } from "../../shared/ipc.ts";
import {
  PET_NAME_MAX_CHARS,
  statNames,
  type Bones,
  type Soul,
  type Stage,
  type Stats,
  type VoiceSpend,
} from "../../shared/pet/model.ts";
import { isRecord } from "../../shared/type-guards.ts";
import type { OmpCommand } from "../git/commit-message.ts";
import { runCommand } from "../git/exec.ts";
import { log } from "../log/log.ts";
import { chooseModel, cleanOutput, enhanceArgs } from "../prompt-enhance/enhance.ts";
import { PET_PERSONALITY_MAX_CHARS } from "./pet-store.ts";

const VOICE_TIMEOUT_MS = 60_000;
/** 气泡里一句话最长多少字符（超出截断）。 */
export const PET_LINE_MAX_CHARS = 120;

export interface VoiceRunner {
  omp: OmpCommand;
  cwd: string;
  /** `@tiny`、`@smol` 或 `provider/model`。 */
  model: string;
  signal: AbortSignal;
  /** 每次调用结束、omp 报了用量时记账。 */
  onSpend(spend: VoiceSpend): void;
}

/**
 * 宠物用哪个模型：配了 tiny 角色就用 `@tiny`（一句俏皮话用最小的模型；仓库所有者 2026-11-11 定），
 * 没配退到 smol（chooseModel：smol / default 都没配时仍交给 omp 解析 `@smol`）。roles 为 null = 读不到配置。
 */
export function chooseVoiceModel(roles: Readonly<Record<string, string>> | null): string {
  return roles?.["tiny"] ? "@tiny" : chooseModel(roles, null);
}

const languageName = (locale: Locale) => (locale === "zh-CN" ? "Simplified Chinese" : "English");

function describe(bones: Bones, stats: Stats): string {
  const statLine = statNames.map((name) => `${name.toUpperCase()} ${stats[name]}`).join(", ");
  return `a ${bones.rarity} ${bones.shiny ? "shiny " : ""}${bones.species} (${statLine})`;
}

/**
 * `omp -p --mode json` 的输出（一行一个事件）：取 assistant 消息的 `message_end`，文字用最后一条，
 * 用量全部加起来（usage.totalTokens、usage.cost.total；omp 18.x 实测，docs/architecture/pet.md「花费」）。
 * 没有 assistant 消息时 spend 为 null。
 */
export function parseJsonOutput(stdout: string): { text: string; spend: VoiceSpend | null } {
  let text = "";
  let replies = 0;
  let tokens = 0;
  let cost = 0;
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(event) || event["type"] !== "message_end" || !isRecord(event["message"])) continue;
    const message = event["message"];
    if (message["role"] !== "assistant") continue;
    const content = Array.isArray(message["content"]) ? message["content"] : [];
    text = content
      .map((part) =>
        isRecord(part) && part["type"] === "text" && typeof part["text"] === "string" ? part["text"] : "",
      )
      .join("");
    const usage = isRecord(message["usage"]) ? message["usage"] : {};
    replies += 1;
    if (typeof usage["totalTokens"] === "number") tokens += usage["totalTokens"];
    if (isRecord(usage["cost"]) && typeof usage["cost"]["total"] === "number") cost += usage["cost"]["total"];
  }
  return { text, spend: replies === 0 ? null : { calls: 1, tokens, cost } };
}

async function run(runner: VoiceRunner, system: string, input: string): Promise<string | null> {
  try {
    const result = await runCommand(
      runner.omp.command,
      [...runner.omp.args, ...enhanceArgs(runner.model, system), "--mode", "json"],
      {
        cwd: runner.cwd,
        // 不等 MCP 服务器：omp 没有关 MCP 的参数（--no-tools 只关内置工具），连上的服务器会把工具声明带进每次请求，
        // 实测一句话 6.9k token 里 6.4k 是它们。1ms 内没就绪的服务器这次不用（stderr 一条警告），进程照常收掉（docs/architecture/pet.md「花费」）。
        env: { ...runner.omp.env, OMP_MCP_TIMEOUT_MS: "1" },
        input,
        timeoutMs: VOICE_TIMEOUT_MS,
        // json 事件带整份请求信息（工具声明等），比纯文字大得多。
        maxBuffer: 4 * 1024 * 1024,
        signal: runner.signal,
      },
    );
    const { text, spend } = parseJsonOutput(result.stdout.toString("utf8"));
    // 失败的调用也可能已经花了钱：有用量就记。
    if (spend !== null) runner.onSpend(spend);
    if (result.code !== 0) {
      log.warn("pet voice: omp failed", { code: result.code });
      return null;
    }
    const cleaned = cleanOutput(text);
    return cleaned === "" ? null : cleaned;
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError"))
      log.warn("pet voice: omp did not run", error instanceof Error ? error.message : error);
    return null;
  }
}

/** 孵化：按物种和属性起名字、写一句性格。模型输出 JSON；解析不了或超长返回 null（下次启动再试）。 */
export async function hatchSoul(runner: VoiceRunner, bones: Bones, locale: Locale, now: number): Promise<Soul | null> {
  const system = [
    "You invent the identity of a tiny pixel-art desktop pet that lives next to a coding app.",
    `The pet is ${describe(bones, bones.stats)}. Its highest stat shapes its character; its lowest is its funny weakness.`,
    `Reply with JSON only: {"name": "...", "personality": "..."}.`,
    `name: one short cute name (at most 12 characters). personality: one sentence, at most 140 characters.`,
    `Write both in ${languageName(locale)}. No markdown, no code fences.`,
  ].join("\n");
  const text = await run(runner, system, "Hatch the pet.");
  if (text === null) return null;
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (json === undefined) return null;
  try {
    const parsed = JSON.parse(json) as { name?: unknown; personality?: unknown };
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    const personality = typeof parsed.personality === "string" ? parsed.personality.trim() : "";
    if (name === "" || name.length > PET_NAME_MAX_CHARS || personality.length > PET_PERSONALITY_MAX_CHARS) return null;
    return { name, personality, hatchedAt: now };
  } catch {
    return null;
  }
}

/** 说话的起因：任务事件（带标题）、被摸、升级、进化。 */
export type VoiceTrigger =
  | { kind: "turn" | "gate" | "recovered" | "error" | "waiting"; title: string }
  | { kind: "pet" }
  | { kind: "levelUp"; level: number }
  | { kind: "evolve"; stage: Stage };

function situation(trigger: VoiceTrigger): string {
  switch (trigger.kind) {
    case "turn":
      return `A coding task titled "${trigger.title}" just finished a turn.`;
    case "recovered":
      return `A coding task titled "${trigger.title}" that had failed earlier just ran fine again.`;
    case "gate":
      return `The user just answered an approval request in the task "${trigger.title}".`;
    case "waiting":
      return `The task "${trigger.title}" is waiting for the user to approve or answer something.`;
    case "error":
      return `The task "${trigger.title}" just crashed with an error.`;
    case "pet":
      return "The user just petted you.";
    case "levelUp":
      return `You just reached level ${trigger.level}.`;
    case "evolve":
      return `You just evolved into your ${trigger.stage} form.`;
  }
}

/** 一句气泡里的话；失败返回 null。 */
export async function speakLine(
  runner: VoiceRunner,
  pet: { bones: Bones; stats: Stats; soul: Soul },
  trigger: VoiceTrigger,
  locale: Locale,
): Promise<string | null> {
  const system = [
    `You are ${pet.soul.name}, ${describe(pet.bones, pet.stats)}: a tiny desktop pet watching the user work with an AI coding agent.`,
    `Personality: ${pet.soul.personality}`,
    "React to the situation in one short line, in character (high SNARK teases, high PATIENCE soothes, high CHAOS is random).",
    `At most 60 characters, in ${languageName(locale)}. No quotes, no emoji spam, no markdown. Never give coding advice.`,
  ].join("\n");
  const text = await run(runner, system, situation(trigger));
  if (text === null) return null;
  const line = text.split("\n")[0]!.trim();
  return line.length > PET_LINE_MAX_CHARS ? `${line.slice(0, PET_LINE_MAX_CHARS - 1)}…` : line;
}
