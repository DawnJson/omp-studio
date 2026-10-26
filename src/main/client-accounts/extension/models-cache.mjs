// 账号 provider 的模型列表缓存：omp 的发现是 `online-if-uncached` + 24 小时缓存，冷启动时不会替我们拉；
// 扩展注册时先读这里的上一次结果（否则一个模型都没有），会话起来后再自己拉一次刷新（见 shim.mjs）。
// 只放模型元数据（id、名字、上下文、能力），没有 token，也不参与任何请求。
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

// v3：行里多了每个模型的 `transport`（chat / messages / responses）；旧缓存直接不用。
const FILE_NAME = "models-cache-v3.json";

/** 刷新间隔：每次会话都拉一遍模型列表太吵，一天里拉一次就够。 */
export const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

function readFile(dir) {
  try {
    const parsed = JSON.parse(readFileSync(path.join(dir, FILE_NAME), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** 这个 provider 上次成功拉到的模型行；没有或读不懂时返回空数组。 */
export function readCachedModels(dir, providerId) {
  const rows = readFile(dir)[providerId]?.rows;
  return Array.isArray(rows) ? rows : [];
}

/** 上次成功的时间（epoch ms）；没有时返回 0。 */
export function readCachedAt(dir, providerId) {
  const at = readFile(dir)[providerId]?.at;
  return typeof at === "number" && Number.isFinite(at) ? at : 0;
}

/** 记住这次拉到的模型行（先写临时文件再改名，写不了就算了）。 */
export function writeCachedModels(dir, providerId, rows) {
  try {
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, FILE_NAME);
    const all = readFile(dir);
    all[providerId] = { at: Date.now(), rows };
    const temp = `${file}.tmp`;
    writeFileSync(temp, JSON.stringify(all), "utf8");
    renameSync(temp, file);
  } catch {}
}
