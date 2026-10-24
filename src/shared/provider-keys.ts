// 设置页能填 API key 的 provider（key 经 `omp auth import` 存进 omp 自己的凭据库，docs/architecture/login.md）。
// 这张表是 omp provider id -> omp 认的环境变量名：出自 omp 文档 environment-variables.md §1（omp 18.12.0 随附）；provider id 取自该表
// "Using `<id>` provider"一列，没有写 id 的行按 omp 的 provider 命名推断 [推测]。变量名只用来提示"key 也可以来自这个环境变量"。
import { loginKind } from "./provider-login.ts";

const providerKeyEnv: Readonly<Record<string, string>> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
  together: "TOGETHER_API_KEY",
  huggingface: "HUGGINGFACE_HUB_TOKEN",
  synthetic: "SYNTHETIC_API_KEY",
  nvidia: "NVIDIA_API_KEY",
  nanogpt: "NANO_GPT_API_KEY",
  novita: "NOVITA_API_KEY",
  venice: "VENICE_API_KEY",
  litellm: "LITELLM_API_KEY",
  xiaomi: "XIAOMI_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  stepfun: "STEPFUN_API_KEY",
  xai: "XAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  mistral: "MISTRAL_API_KEY",
  zai: "ZAI_API_KEY",
  "zhipu-coding-plan": "ZHIPU_API_KEY",
  minimax: "MINIMAX_API_KEY",
  "minimax-code": "MINIMAX_CODE_API_KEY",
  "minimax-code-cn": "MINIMAX_CODE_CN_API_KEY",
  "opencode-go": "OPENCODE_API_KEY",
  "opencode-zen": "OPENCODE_API_KEY",
  qianfan: "QIANFAN_API_KEY",
  "qwen-portal": "QWEN_PORTAL_API_KEY",
  zenmux: "ZENMUX_API_KEY",
  "vercel-ai-gateway": "AI_GATEWAY_API_KEY",
  deepinfra: "DEEPINFRA_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  siliconflow: "SILICONFLOW_API_KEY",
  "siliconflow-cn": "SILICONFLOW_CN_API_KEY",
  kilo: "KILO_API_KEY",
  "ollama-cloud": "OLLAMA_CLOUD_API_KEY",
  "cline-pass": "CLINE_API_KEY",
  baseten: "BASETEN_API_KEY",
  sambanova: "SAMBANOVA_API_KEY",
  "alibaba-coding-plan": "ALIBABA_CODING_PLAN_API_KEY",
  "alibaba-token-plan": "ALIBABA_TOKEN_PLAN_API_KEY",
};

/** provider 对应的环境变量名；这个 provider 不支持 API key 路线时为 null。 */
export function apiKeyEnvName(providerId: string): string | null {
  return Object.hasOwn(providerKeyEnv, providerId) ? (providerKeyEnv[providerId] ?? null) : null;
}

/** 设置页能填 API key：omp 认它的 key 环境变量，或者它在 omp 里的登录就是粘贴 API key（provider-login.ts）。 */
export function acceptsApiKey(providerId: string): boolean {
  return apiKeyEnvName(providerId) !== null || loginKind(providerId) === "api-key";
}
