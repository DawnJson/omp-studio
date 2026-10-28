// `tavily-keys.mjs` 的类型声明：扩展文件是纯 JS（直接部署给 omp 用），这里只给仓库里的 TS 测试看形状。

export declare function readBackupKeys(file: string): string[];

export declare function rotateStoredKey(envFile: string, keysFile: string, dead: string, next: string): boolean;

export declare function withBackupKeys(
  fetchImpl: (input: unknown, init?: RequestInit) => Promise<Response>,
  loadKeys: () => readonly string[],
  onSwitched?: (dead: string, next: string) => void,
): (input: unknown, init?: RequestInit) => Promise<Response>;

export declare function installTavilyBackupKeys(
  keysFile: string,
  envFile: string,
  logger: { warn(message: string, details?: unknown): void },
): void;
