// 设置页输入的 API key：用 Electron safeStorage（Windows 上是 DPAPI）加密后存在 userData/api-keys.json，
// 启动 omp 时以 omp 认的环境变量传进去（docs/architecture/login.md）。不写 ~/.omp，不用 --api-key 参数。
// 这个文件不依赖 electron，可以单测；应用里的实例和 getApiKeyEnv 在 api-keys.ts。
// key 只从渲染进程进来，不从这里出去：对外只有 provider id 列表和注入环境变量用的 env()。
import { readFile, rename, writeFile } from "node:fs/promises";
import { apiKeyEnvName } from "../../shared/provider-keys.ts";

/** safeStorage 的最小接口，测试里换成假的。 */
export interface KeyCipher {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

interface KeyFile {
  version: 1;
  /** provider id → base64 的密文。 */
  keys: Record<string, string>;
}

export class ApiKeyStore {
  readonly #file: string;
  readonly #cipher: KeyCipher;
  /** 读改写串行，避免两次 saveApiKey 互相覆盖。 */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(file: string, cipher: KeyCipher) {
    this.#file = file;
    this.#cipher = cipher;
  }

  #exclusive<T>(job: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(job);
    this.#queue = run.catch(() => {});
    return run;
  }

  async #read(): Promise<KeyFile> {
    let text: string;
    try {
      text = await readFile(this.#file, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return { version: 1, keys: {} };
      throw error;
    }
    const json: unknown = JSON.parse(text);
    if (
      typeof json !== "object" ||
      json === null ||
      !("keys" in json) ||
      typeof json.keys !== "object" ||
      json.keys === null
    ) {
      throw new Error(`${this.#file} is not an API key file`);
    }
    const keys: Record<string, string> = {};
    for (const [provider, value] of Object.entries(json.keys)) if (typeof value === "string") keys[provider] = value;
    return { version: 1, keys };
  }

  async #write(file: KeyFile): Promise<void> {
    const temp = `${this.#file}.tmp`;
    await writeFile(temp, JSON.stringify(file), { encoding: "utf8", mode: 0o600 });
    await rename(temp, this.#file);
  }

  async save(providerId: string, key: string): Promise<void> {
    if (apiKeyEnvName(providerId) === null)
      throw new Error(`provider ${providerId} does not support an API key set from omp-studio`);
    if (key.trim() === "") throw new Error("the API key is empty");
    // NUL 等控制字符会让 spawn 失败，错误信息还可能带出 key 原文：保存时就拒绝。
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(key.trim()))
      throw new Error("the API key contains control characters (such as a line break or NUL); paste it again");
    if (!this.#cipher.isEncryptionAvailable())
      throw new Error("the system cannot encrypt the key here, so it was not saved");
    const encrypted = this.#cipher.encryptString(key.trim()).toString("base64");
    await this.#exclusive(async () => {
      const file = await this.#read();
      file.keys[providerId] = encrypted;
      await this.#write(file);
    });
  }

  async clear(providerId: string): Promise<void> {
    await this.#exclusive(async () => {
      const file = await this.#read();
      if (!(providerId in file.keys)) return;
      delete file.keys[providerId];
      await this.#write(file);
    });
  }

  async list(): Promise<string[]> {
    return Object.keys((await this.#read()).keys).filter((provider) => apiKeyEnvName(provider) !== null);
  }

  /** 环境变量名 → key，给 omp 子进程用。解不开的条目（换了系统账户、文件被拷走）直接跳过，不阻止 omp 启动。 */
  async env(): Promise<Record<string, string>> {
    const { keys } = await this.#read();
    const env: Record<string, string> = {};
    for (const [provider, encrypted] of Object.entries(keys)) {
      const name = apiKeyEnvName(provider);
      if (name === null) continue;
      try {
        env[name] = this.#cipher.decryptString(Buffer.from(encrypted, "base64"));
      } catch {
        continue;
      }
    }
    return env;
  }
}
