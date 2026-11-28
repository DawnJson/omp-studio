// 提示词优化的 IPC（docs/architecture/prompt-enhance.md）：校验参数，定 cwd、上下文和模型，流式回推预览，委托 prompt-enhance/enhance.ts。
// 每个输入框（任务 / 草稿页的项目）同时只有一次：同一个输入框再发起时先取消上一次。退出时全部取消（runCommand 结束进程树）。
import type { HandlerGroup, ModelKey, ProjectId } from "../../shared/ipc.ts";
import {
  PROMPT_ENHANCE_CUSTOM_MAX_CHARS,
  PROMPT_ENHANCE_MAX_CHARS,
  PROMPT_ENHANCE_STYLES,
  type PromptEnhanceOptions,
  type PromptEnhanceSettings,
  type PromptEnhanceStyle,
  type PromptEnhanceTarget,
} from "../../shared/prompt-enhance.ts";
import { log } from "../log/log.ts";
import { readModelRoles } from "../omp-config/model-defaults.ts";
import { buildEnhanceContext } from "../prompt-enhance/context.ts";
import { chooseModel, enhancePrompt } from "../prompt-enhance/enhance.ts";
import { oneShotOmp } from "../prompt-enhance/one-shot-omp.ts";
import { serviceCwd } from "../service/service-omp.ts";
import { getSettings, updateSettings } from "../settings/settings-store.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import { registerShutdownHook } from "../window/shutdown.ts";
import { emitEvent } from "./events.ts";
import { listOmpConfig } from "./omp-handlers.ts";
import {
  IpcValidationError,
  parseBoolean,
  parseModelKey,
  parseOneOf,
  parseProjectId,
  parseRecord,
  parseString,
  parseTaskId,
} from "./validate.ts";

const running = new Map<string, AbortController>();
const STREAM_THROTTLE_MS = 30;

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

function parseStyle(value: unknown, label: string): PromptEnhanceStyle {
  return parseOneOf(value, label, PROMPT_ENHANCE_STYLES);
}

function parseOptions(value: unknown): PromptEnhanceOptions {
  if (value === undefined || value === null) return {};
  const record = parseRecord(value, "options");
  const out: PromptEnhanceOptions = {};
  if (record["requestId"] !== undefined) out.requestId = parseString(record["requestId"], "options.requestId", 128);
  if (record["style"] !== undefined) out.style = parseStyle(record["style"], "options.style");
  if (record["customInstruction"] !== undefined) {
    out.customInstruction = parseString(
      record["customInstruction"],
      "options.customInstruction",
      PROMPT_ENHANCE_CUSTOM_MAX_CHARS,
      { allowEmpty: true },
    );
  }
  if (record["includeHistory"] !== undefined) {
    out.includeHistory = parseBoolean(record["includeHistory"], "options.includeHistory");
  }
  if (record["includeGit"] !== undefined) out.includeGit = parseBoolean(record["includeGit"], "options.includeGit");
  return out;
}

function parseSettingsPatch(value: unknown): Partial<PromptEnhanceSettings> {
  const record = parseRecord(value, "promptEnhance");
  const patch: Partial<PromptEnhanceSettings> = {};
  if (record["style"] !== undefined) patch.style = parseStyle(record["style"], "promptEnhance.style");
  if (record["customInstruction"] !== undefined) {
    patch.customInstruction = parseString(
      record["customInstruction"],
      "promptEnhance.customInstruction",
      PROMPT_ENHANCE_CUSTOM_MAX_CHARS,
      { allowEmpty: true },
    );
  }
  if (record["includeHistory"] !== undefined) {
    patch.includeHistory = parseBoolean(record["includeHistory"], "promptEnhance.includeHistory");
  }
  if (record["includeGit"] !== undefined) {
    patch.includeGit = parseBoolean(record["includeGit"], "promptEnhance.includeGit");
  }
  return patch;
}

/** 在哪个目录里跑：任务的 cwd（项目 .omp/config.yml 的角色照常生效），草稿页是项目目录，没有项目时是服务进程的中性目录。 */
async function targetEnv(target: PromptEnhanceTarget): Promise<{ cwd: string; sessionFile: string | null }> {
  if (target.kind === "task") {
    const pool = await getTaskPool();
    return { cwd: pool.taskGitContext(target.taskId).cwd, sessionFile: pool.sessionFileOf(target.taskId) };
  }
  if (target.projectId === null) return { cwd: await serviceCwd(), sessionFile: null };
  return { cwd: await (await getTaskPool()).projectPath(target.projectId), sessionFile: null };
}

export const promptEnhanceHandlers: HandlerGroup<"enhancePrompt" | "cancelEnhancePrompt" | "setPromptEnhanceSettings"> =
  {
    enhancePrompt: async (rawTarget, rawText, rawFallback, rawOptions) => {
      const target = parseTarget(rawTarget);
      const text = parseString(rawText, "text", PROMPT_ENHANCE_MAX_CHARS);
      const fallback = parseFallback(rawFallback);
      const options = parseOptions(rawOptions);
      const saved = getSettings().promptEnhance;
      const style = options.style ?? saved.style;
      const customInstruction = options.customInstruction ?? saved.customInstruction;
      const includeHistory = (options.includeHistory ?? saved.includeHistory) && target.kind === "task";
      const includeGit = options.includeGit ?? saved.includeGit;
      const requestId = options.requestId ?? "";

      const key = targetKey(target);
      running.get(key)?.abort();
      const controller = new AbortController();
      running.set(key, controller);
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      try {
        const { cwd, sessionFile } = await targetEnv(target);
        // 读不到配置（omp 还没就绪等）不挡优化：交给 omp 自己解析 @smol。
        const roles = readModelRoles({ list: listOmpConfig }, cwd).catch((error: unknown) => {
          log.warn("prompt enhance: model roles unreadable", error instanceof Error ? error.message : error);
          return null;
        });
        const contextTask = buildEnhanceContext({ sessionFile, cwd, includeHistory, includeGit });
        const [resolvedRoles, omp, context] = await Promise.all([
          roles,
          oneShotOmp("STUDIO_TEST_ENHANCE_OMP"),
          contextTask,
        ]);
        const model = chooseModel(resolvedRoles, fallback);
        if (controller.signal.aborted) return { kind: "cancelled" };

        let pendingPreview: string | null = null;
        let lastSentAt = 0;
        const emitNow = (preview: string) => {
          if (controller.signal.aborted || requestId === "") return;
          lastSentAt = Date.now();
          pendingPreview = null;
          emitEvent("promptEnhanceStream", { target, requestId, text: preview });
        };
        const onStream =
          requestId === ""
            ? undefined
            : (preview: string) => {
                if (controller.signal.aborted) return;
                const elapsed = Date.now() - lastSentAt;
                if (elapsed >= STREAM_THROTTLE_MS) {
                  if (flushTimer !== null) {
                    clearTimeout(flushTimer);
                    flushTimer = null;
                  }
                  emitNow(preview);
                } else {
                  pendingPreview = preview;
                  if (flushTimer === null) {
                    flushTimer = setTimeout(() => {
                      flushTimer = null;
                      if (pendingPreview !== null) emitNow(pendingPreview);
                    }, STREAM_THROTTLE_MS - elapsed);
                  }
                }
              };

        const result = await enhancePrompt(text, {
          cwd,
          omp,
          model,
          signal: controller.signal,
          style,
          customInstruction,
          context,
          ...(onStream && { onStream }),
        });
        log.info("prompt enhance", {
          result: result.kind,
          model: model === "@smol" ? "@smol" : "fallback",
          style,
          history: context.history !== null,
          git: context.gitFiles !== null,
          chars: text.length,
          ...(result.kind === "enhanced" ? { outChars: result.text.length } : {}),
          ...(result.kind === "failed" ? { message: result.message } : {}),
        });
        return result;
      } finally {
        if (flushTimer !== null) clearTimeout(flushTimer);
        if (running.get(key) === controller) running.delete(key);
      }
    },

    cancelEnhancePrompt: async (rawTarget) => {
      running.get(targetKey(parseTarget(rawTarget)))?.abort();
    },

    setPromptEnhanceSettings: async (rawPatch) => {
      const patch = parseSettingsPatch(rawPatch);
      updateSettings({ promptEnhance: { ...getSettings().promptEnhance, ...patch } });
    },
  };
