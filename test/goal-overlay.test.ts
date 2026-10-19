// “目标自动推进”：启动参数里 `--config <覆盖文件>` 当且仅当开关打开；覆盖文件的内容；路径含空格和中文也原样作为一个参数。
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeGoalOverlay } from "../src/main/omp/goal-overlay.ts";
import { buildOmpArgs, goalContinuationOverlay } from "../src/main/omp/launch-args.ts";

let scratch: string;
beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio 覆盖-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("buildOmpArgs 的 --config 覆盖", () => {
  it("没有 configOverlay 时不带 --config", () => {
    expect(buildOmpArgs({ cwd: "x" })).toEqual(["--mode", "rpc-ui"]);
    expect(buildOmpArgs({ cwd: "x" })).not.toContain("--config");
  });

  it("有 configOverlay 时带 --config <路径>，路径含空格和中文也是一个参数", () => {
    const overlay = path.join(scratch, "omp overlay 目录", "goal-continuation.yml");
    const args = buildOmpArgs({ cwd: "x", model: { provider: "p", modelId: "m" }, configOverlay: overlay });
    expect(args).toEqual(["--mode", "rpc-ui", "--model", "p/m", "--config", overlay]);
  });
});

describe("writeGoalOverlay", () => {
  it("写出 goal.continuationModes = [interactive, rpc]，返回路径，不留临时文件，重复写同一个文件", async () => {
    const dir = path.join(scratch, "用户 数据", "omp-overlay");
    const [first, second] = await Promise.all([writeGoalOverlay(dir), writeGoalOverlay(dir)]);
    expect(first).toBe(path.join(dir, "goal-continuation.yml"));
    expect(second).toBe(first);
    expect(await readFile(first, "utf8")).toBe(goalContinuationOverlay);
    expect(goalContinuationOverlay).toBe("goal:\n  continuationModes: [interactive, rpc]\n");
    expect(await readdir(dir)).toEqual(["goal-continuation.yml"]);
  });
});
