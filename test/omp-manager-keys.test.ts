import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiKeyStore, type KeyCipher } from "../src/main/omp-manager/api-key-store.ts";
import { apiKeyEnvName } from "../src/shared/provider-keys.ts";

let scratch: string;
beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio 密钥 "));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** 假加密：可逆但不是明文；available=false 模拟系统没有可用的密钥存储。 */
function cipher(available = true): KeyCipher {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(plain, "utf8").reverse(),
    decryptString: (encrypted) => {
      if (encrypted.toString("utf8").startsWith("!")) throw new Error("cannot decrypt");
      return Buffer.from(encrypted).reverse().toString("utf8");
    },
  };
}

describe("ApiKeyStore", () => {
  it("turns saved keys into the environment variables omp reads, and never writes the key to disk in plain text", async () => {
    const file = path.join(scratch, "a.json");
    const store = new ApiKeyStore(file, cipher());
    await store.save("deepseek", "  sk-secret-123  ");
    await store.save("anthropic", "sk-ant-xyz");
    expect(await store.env()).toEqual({ DEEPSEEK_API_KEY: "sk-secret-123", ANTHROPIC_API_KEY: "sk-ant-xyz" });
    expect(await readFile(file, "utf8")).not.toContain("sk-secret-123");
    expect((await store.list()).sort()).toEqual(["anthropic", "deepseek"]);
  });

  it("clears one provider without touching the others, and clearing a missing one is silent", async () => {
    const store = new ApiKeyStore(path.join(scratch, "b.json"), cipher());
    await store.save("deepseek", "k1");
    await store.save("openai", "k2");
    await store.clear("deepseek");
    await store.clear("never-set");
    expect(await store.env()).toEqual({ OPENAI_API_KEY: "k2" });
  });

  it("rejects a key with a NUL or line break, without echoing it, so a spawn error can never carry the key", async () => {
    const store = new ApiKeyStore(path.join(scratch, "g.json"), cipher());
    const error = await store.save("openai", "sk-secret\u0000tail").catch((e: unknown) => e);
    expect((error as Error).message).toMatch(/control characters/);
    expect((error as Error).message).not.toContain("sk-secret");
    await expect(store.save("openai", "sk-a\nb")).rejects.toThrow(/control characters/);
  });

  it("refuses a provider that has no known environment variable, an empty key, and a system without encryption", async () => {
    const store = new ApiKeyStore(path.join(scratch, "c.json"), cipher());
    await expect(store.save("not-a-provider", "k")).rejects.toThrow(/does not support/);
    await expect(store.save("openai", "   ")).rejects.toThrow(/empty/);
    await expect(new ApiKeyStore(path.join(scratch, "d.json"), cipher(false)).save("openai", "k")).rejects.toThrow(/cannot encrypt/);
  });

  it("skips an entry that cannot be decrypted (file from another Windows account) instead of failing every launch", async () => {
    const file = path.join(scratch, "e.json");
    await writeFile(file, JSON.stringify({ version: 1, keys: { openai: Buffer.from("!garbage").toString("base64"), groq: cipher().encryptString("kg").toString("base64") } }));
    expect(await new ApiKeyStore(file, cipher()).env()).toEqual({ GROQ_API_KEY: "kg" });
  });

  it("serializes concurrent saves so none is lost", async () => {
    const store = new ApiKeyStore(path.join(scratch, "f.json"), cipher());
    await Promise.all([store.save("openai", "1"), store.save("groq", "2"), store.save("mistral", "3")]);
    expect(Object.keys(await store.env()).sort()).toEqual(["GROQ_API_KEY", "MISTRAL_API_KEY", "OPENAI_API_KEY"]);
  });
});

describe("apiKeyEnvName", () => {
  it("does not treat prototype names as providers", () => {
    expect(apiKeyEnvName("constructor")).toBeNull();
    expect(apiKeyEnvName("openai")).toBe("OPENAI_API_KEY");
  });
});
