// `adapter.mjs` 的类型声明：扩展文件是纯 JS（直接部署给 omp 用），这里只给仓库里的 TS 测试看形状。
export interface AccountModelRow {
  id: string;
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
}

export declare const SESSION_HEADER: string;

export declare const OPENAI_COMPATIBLE_NPM: string;

export declare function supportsChatTransport(model: unknown): boolean;

export declare function stripType(credential: unknown): Record<string, unknown> | null;

export declare function pickSignInMethod(methods: unknown): unknown | null;

export declare function modelRowFromRuntime(model: unknown, fallbackContext?: number): AccountModelRow;

export declare const STRETCHED_EXPIRY_MS: number;

export declare function stretchExpiry<T>(credential: T, now?: number): T;

export declare function toPluginAuth<T>(credential: T, now?: number): T;
