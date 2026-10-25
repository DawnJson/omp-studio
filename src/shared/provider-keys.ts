// 设置页能填 API key 的 provider（key 经 `omp auth import` 存进 omp 自己的凭据库，docs/architecture/login.md）。
// 这张表是 omp provider id -> omp 认的环境变量名（按 omp 查找的先后排：第一个是主名，后面是文档写的 fallback / 别名）：出自 omp 文档
// environment-variables.md §1（omp 18.12.0 随附，别名按 18.12.6 的文档补）；provider id 取自该表"Using `<id>` provider"一列，没有写 id 的行
// 按 omp 的 provider 命名推断 [推测]。用途：卡片上写 key 来自哪个变量；变量写在 agent 目录 `.env` 里时"设置 API key"改那一行。
// 搜索服务（表尾四个）出自同一文档 §3 "Search provider credentials"；omp 18.12.6 的 `get_login_providers` 里有这四个 id。
import type { EnvSource } from "./custom-models.ts";
import { loginKind } from "./provider-login.ts";

const keyEnvTable: Readonly<Record<string, readonly string[]>> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GEMINI_API_KEY"],
  groq: ["GROQ_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
  fireworks: ["FIREWORKS_API_KEY"],
  together: ["TOGETHER_API_KEY"],
  huggingface: ["HUGGINGFACE_HUB_TOKEN", "HF_TOKEN"],
  synthetic: ["SYNTHETIC_API_KEY"],
  nvidia: ["NVIDIA_API_KEY"],
  nanogpt: ["NANO_GPT_API_KEY"],
  novita: ["NOVITA_API_KEY"],
  venice: ["VENICE_API_KEY"],
  litellm: ["LITELLM_API_KEY"],
  xiaomi: ["XIAOMI_API_KEY"],
  moonshot: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
  stepfun: ["STEPFUN_API_KEY"],
  xai: ["XAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  zai: ["ZAI_API_KEY"],
  "zhipu-coding-plan": ["ZHIPU_API_KEY"],
  minimax: ["MINIMAX_API_KEY"],
  "minimax-code": ["MINIMAX_CODE_API_KEY"],
  "minimax-code-cn": ["MINIMAX_CODE_CN_API_KEY"],
  "opencode-go": ["OPENCODE_API_KEY"],
  "opencode-zen": ["OPENCODE_API_KEY"],
  qianfan: ["QIANFAN_API_KEY"],
  "qwen-portal": ["QWEN_PORTAL_API_KEY"],
  zenmux: ["ZENMUX_API_KEY"],
  "vercel-ai-gateway": ["AI_GATEWAY_API_KEY", "VERCEL_AI_GATEWAY_API_KEY"],
  deepinfra: ["DEEPINFRA_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  siliconflow: ["SILICONFLOW_API_KEY"],
  "siliconflow-cn": ["SILICONFLOW_CN_API_KEY"],
  kilo: ["KILO_API_KEY"],
  "ollama-cloud": ["OLLAMA_CLOUD_API_KEY"],
  "cline-pass": ["CLINE_API_KEY"],
  baseten: ["BASETEN_API_KEY"],
  sambanova: ["SAMBANOVA_API_KEY"],
  "alibaba-coding-plan": ["ALIBABA_CODING_PLAN_API_KEY"],
  "alibaba-token-plan": ["ALIBABA_TOKEN_PLAN_API_KEY"],
  tavily: ["TAVILY_API_KEY"],
  exa: ["EXA_API_KEY"],
  kagi: ["KAGI_API_KEY"],
  parallel: ["PARALLEL_API_KEY"],
};

/** provider 认的 key 环境变量，按 omp 查找的先后排；这个 provider 不支持 API key 路线时为空。 */
function apiKeyEnvNames(providerId: string): readonly string[] {
  return Object.hasOwn(keyEnvTable, providerId) ? (keyEnvTable[providerId] ?? []) : [];
}

/** provider 的主变量名（自定义 provider 默认引用的名字）；不支持 API key 路线时为 null。 */
export function apiKeyEnvName(providerId: string): string | null {
  return apiKeyEnvNames(providerId)[0] ?? null;
}

/** 这个 provider 的 key 现在实际取自哪个变量、设在哪。 */
export interface ProviderKeyEnv {
  name: string;
  source: EnvSource;
}

/**
 * omp 按先后取第一个设了的变量（系统或 `.env` 都算），所以 `HF_TOKEN` 写在 `.env`、`HUGGINGFACE_HUB_TOKEN` 没设时用的是 `HF_TOKEN`。
 * 一个都没设时回主名（`missing`）；这个 provider 没有 key 变量时 null。
 */
export function providerKeyEnv(providerId: string, sourceOf: (name: string) => EnvSource): ProviderKeyEnv | null {
  const names = apiKeyEnvNames(providerId);
  if (names.length === 0) return null;
  for (const name of names) {
    const source = sourceOf(name);
    if (source !== "missing") return { name, source };
  }
  return { name: names[0]!, source: "missing" };
}

/** 能填 key 的内置 provider 的 id（主进程一次查出它们的 key 变量设在哪）。 */
export function keyEnvProviderIds(): string[] {
  return Object.keys(keyEnvTable);
}

const providerKeyEnvNames: ReadonlySet<string> = new Set(Object.values(keyEnvTable).flat());

/** 这个变量名是 omp 某个内置 provider 认的 key 环境变量（自定义 provider 不再引用它时，`.env` 里也不能删：内置 provider 还在用）。 */
export function isProviderKeyEnv(name: string): boolean {
  return providerKeyEnvNames.has(name);
}

/** 设置页能填 API key：omp 认它的 key 环境变量，或者它在 omp 里的登录就是粘贴 API key（provider-login.ts）。 */
export function acceptsApiKey(providerId: string): boolean {
  return apiKeyEnvName(providerId) !== null || loginKind(providerId) === "api-key";
}
