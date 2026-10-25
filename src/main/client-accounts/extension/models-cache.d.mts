// `models-cache.mjs` 的类型声明：扩展文件是纯 JS（直接部署给 omp 用），这里只给仓库里的 TS 测试看形状。
import type { AccountModelRow } from "./adapter.d.mts";

export declare const CATALOG_TTL_MS: number;

export declare function readCachedModels(dir: string, providerId: string): AccountModelRow[];

export declare function readCachedAt(dir: string, providerId: string): number;

export declare function writeCachedModels(dir: string, providerId: string, rows: AccountModelRow[]): void;
