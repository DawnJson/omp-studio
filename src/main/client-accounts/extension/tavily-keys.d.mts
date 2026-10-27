// `tavily-keys.mjs` 的类型声明：扩展文件是纯 JS（直接部署给 omp 用），这里只给仓库里的 TS 测试看形状。

export declare function readBackupKeys(file: string): string[];

export declare function withBackupKeys(
  fetchImpl: (input: unknown, init?: RequestInit) => Promise<Response>,
  loadKeys: () => readonly string[],
): (input: unknown, init?: RequestInit) => Promise<Response>;

export declare function installTavilyBackupKeys(file: string): void;
