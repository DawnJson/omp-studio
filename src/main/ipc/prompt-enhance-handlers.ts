// 提示词优化的 IPC（docs/architecture/prompt-enhance.md）：校验参数，定 cwd 和模型，委托 prompt-enhance/enhance.ts。
// 每个输入框（任务 / 草稿页的项目）同时只有一次：同一个输入框再发起时先取消上一次。退出时全部取消（runCommand 结束进程树）。
import type { HandlerGroup, ModelKey, ProjectId } from "../../shared/ipc.ts";
import { PROMPT_ENHANCE_MAX_CHARS, type PromptEnhanceTarget } from "../../shared/prompt-enhance.ts";
import { log } from "../log/log.ts";
import { readModelRoles } from "../omp-config/model-defaults.ts";
import { oneShotOmp } from "../prompt-enhance/one-shot-omp.ts";
import { chooseModel, enhancePrompt } from "../prompt-enhance/enhance.ts";
import { serviceCwd } from "../service/service-omp.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import { registerShutdownHook } from "../window/shutdown.ts";
import { listOmpConfig } from "./omp-handlers.ts";
import {
  IpcValidationError,
  parseModelKey,
  parseOneOf,
  parseProjectId,
  parseRecord,
  parseString,
  parseTaskId,
} from "./validate.ts";

const running = new Map<string, AbortController>();

registerShutdownHook(async () => {
  for (const controller of running.values()) controller.abort();
});

function parseTarget(value: unknown): PromptEnhanceTarget {
  const record = parseRecord(value, "target");
  const kind = parseOneOf(record["kind"], "target.kind", ["task", "draft"]);
  if (kind === "task") return { kind, taskId: parseTaskId(record["taskId"]) };
  const projectId: ProjectId | null = record["projectId"] === null ? null : parseProjectId(record["projectId"]);
  return { kind, projectId };
}

const targetKey = (target: PromptEnhanceTarget): string =>
  target.kind === "task" ? `task:${target.taskId}` : `draft:${target.projectId ?? ""}`;

function parseFallback(value: unknown): ModelKey | null {
  if (value === null) return null;
  const key = parseModelKey(value);
  // 会成为 `--model provider/id` 的值：不能像一个选项。
  if (key.provider.startsWith("-")) throw new IpcValidationError("model.provider 不能以 - 开头");
  return key;
}

/** 在哪个目录里跑：任务的 cwd（项目 .omp/config.yml 的角色照常生效），草稿页是项目目录，没有项目时是服务进程的中性目录。 */
async function targetCwd(target: PromptEnhanceTarget): Promise<string> {
  if (target.kind === "task") return (await getTaskPool()).taskGitContext(target.taskId).cwd;
  if (target.projectId === null) return serviceCwd();
  return (await getTaskPool()).projectPath(target.projectId);
}

export const promptEnhanceHandlers: HandlerGroup<"enhancePrompt" | "cancelEnhancePrompt"> = {
  enhancePrompt: async (rawTarget, rawText, rawFallback) => {
    const target = parseTarget(rawTarget);
    const text = parseString(rawText, "text", PROMPT_ENHANCE_MAX_CHARS);
    const fallback = parseFallback(rawFallback);
    const key = targetKey(target);
    running.get(key)?.abort();
    const controller = new AbortController();
    running.set(key, controller);
    try {
      const cwd = await targetCwd(target);
      // 读不到配置（omp 还没就绪等）不挡优化：交给 omp 自己解析 @smol。
      const roles = readModelRoles({ list: listOmpConfig }, cwd).catch((error: unknown) => {
        log.warn("prompt enhance: model roles unreadable", error instanceof Error ? error.message : error);
        return null;
      });
      const [resolvedRoles, omp] = await Promise.all([roles, oneShotOmp("STUDIO_TEST_ENHANCE_OMP")]);
      const model = chooseModel(resolvedRoles, fallback);
      if (controller.signal.aborted) return { kind: "cancelled" };
      const result = await enhancePrompt(text, { cwd, omp, model, signal: controller.signal });
      log.info("prompt enhance", {
        result: result.kind,
        model: model === "@smol" ? "@smol" : "fallback",
        chars: text.length,
        ...(result.kind === "enhanced" ? { outChars: result.text.length } : {}),
        ...(result.kind === "failed" ? { message: result.message } : {}),
      });
      return result;
    } finally {
      if (running.get(key) === controller) running.delete(key);
    }
  },

  cancelEnhancePrompt: async (rawTarget) => {
    running.get(targetKey(parseTarget(rawTarget)))?.abort();
  },
};
