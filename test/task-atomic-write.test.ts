import { mkdtemp, readdir, readFile, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RENAME_ATTEMPTS, writeFileAtomic, type AtomicWriteOps } from "../src/main/tasks/atomic-write.ts";

let scratch: string;
beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio 原子写-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function failing(code: string, times: number): AtomicWriteOps & { calls: number } {
  const ops = {
    calls: 0,
    rename: async (from: string, to: string) => {
      ops.calls++;
      if (ops.calls <= times) throw Object.assign(new Error(`${code}: simulated`), { code });
      await rename(from, to);
    },
    sleep: async () => {},
  };
  return ops;
}

describe("writeFileAtomic：Windows 上 rename 被杀毒/索引短暂占用（EPERM）", () => {
  it("短暂的 EPERM/EBUSY 重试后成功，内容完整，没有残留临时文件", async () => {
    const file = path.join(scratch, "a", "x.json");
    const ops = failing("EPERM", 3);
    await writeFileAtomic(file, "hello 你好", "t", ops);
    expect(ops.calls).toBe(4);
    expect(await readFile(file, "utf8")).toBe("hello 你好");
    expect(await readdir(path.dirname(file))).toEqual(["x.json"]);
  });

  it("一直被占用时重试有上限，最后抛出原错误并清掉临时文件", async () => {
    const file = path.join(scratch, "b", "x.json");
    const ops = failing("EBUSY", 1000);
    await expect(writeFileAtomic(file, "x", "t", ops)).rejects.toThrow(/EBUSY/);
    expect(ops.calls).toBe(RENAME_ATTEMPTS);
    expect(await readdir(path.dirname(file))).toEqual([]);
  });

  it("不是临时性错误（比如 ENOENT）立即抛出，不重试", async () => {
    const ops = failing("ENOENT", 1000);
    await expect(writeFileAtomic(path.join(scratch, "c", "x.json"), "x", "t", ops)).rejects.toThrow(/ENOENT/);
    expect(ops.calls).toBe(1);
  });
});
