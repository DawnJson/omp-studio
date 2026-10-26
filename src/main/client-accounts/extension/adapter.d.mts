// `adapter.mjs` 的类型声明：扩展文件是纯 JS（直接部署给 omp 用），这里只给仓库里的 TS 测试看形状。
export type Transport = "chat" | "messages" | "responses";

export interface AccountModelRow {
  id: string;
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
  baseUrl?: string;
  transport: Transport;
}

export interface StoredCredential {
  access: string;
  refresh: string;
  expires: number;
  studioCredential?: "api";
  [key: string]: unknown;
}

export declare function pluginFactory(value: unknown): ((...args: unknown[]) => unknown) | null;

export declare function pickSignInMethod(methods: unknown): unknown | null;

export declare function defaultInputs(method: unknown): Record<string, unknown>;

export declare const NO_EXPIRY: number;

export declare function normalizeCredential(credential: unknown): StoredCredential | null;

export declare function mergeCredential(current: unknown, next: unknown): StoredCredential | null;

export declare const STRETCHED_EXPIRY_MS: number;

export declare function stretchExpiry<T>(credential: T, now?: number): T;

export declare function toPluginAuth(
  credential: unknown,
  options?: { stretch?: boolean; now?: number },
): Record<string, unknown> | null | undefined;

export declare const TRANSPORTS: Readonly<Record<string, Transport>>;

export declare function modelRow(
  key: string,
  model: unknown,
  provider?: { npm?: string; baseUrl?: string },
): AccountModelRow | null;

export declare function pluginUrl(url: string, transport: Transport, baseUrl?: string): string;

export interface AccountUsageLimit {
  id: string;
  label: string;
  scope: { provider: string };
  window?: { id: string; label: string; durationMs?: number; resetsAt?: number };
  amount: { used?: number; limit?: number; remaining?: number; usedFraction?: number; unit: string };
  status: "ok" | "warning" | "exhausted" | "unknown";
  notes?: string[];
}

export interface AccountUsageReport {
  provider: string;
  fetchedAt: number;
  limits: AccountUsageLimit[];
  metadata: { planType?: string; email?: string; user?: string };
}

export declare function usageReport(provider: string, result: unknown, now?: number): AccountUsageReport | null;
