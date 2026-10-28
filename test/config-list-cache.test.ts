// `omp config list --json` 的按目录缓存（omp-config/config-list-cache.ts，指纹同 omp-handlers.ts：omp 版本 + configListInputs 的修改时间）。
// 数"真跑了几次 omp"：审批胶囊、轮次结束的通知开关这类反复读的地方，配置没变时不再起 omp；改了配置、写了配置之后的读要读到新的。
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigListCache, configListInputs } from "../src/main/omp-config/config-list-cache.ts";
import { inputStamp } from "../src/main/service/input-stamp.ts";

let scratch: string;
beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio config 缓存-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function setup(name: string) {
  const agentDir = path.join(scratch, name, "agent");
  const project = path.join(scratch, name, "项目");
  await mkdir(agentDir, { recursive: true });
  await mkdir(project, { recursive: true });
  await writeFile(path.join(agentDir, "config.yml"), "tools:\n  approvalMode: write\n");
  const runs: string[] = [];
  let fail = false;
  const cache = new ConfigListCache({
    stamp: (dir) => inputStamp("18.13.3", configListInputs(agentDir, dir)),
    run: async (dir) => {
      runs.push(dir);
      if (fail) throw new Error("omp config list failed");
      return { "tools.approvalMode": { value: `run ${runs.length}` } };
    },
    key: (dir) => dir,
  });
  return { agentDir, project, runs, cache, failNext: (value: boolean) => (fail = value) };
}

const later = (seconds: number) => new Date(Date.now() + seconds * 1000);

describe("ConfigListCache", () => {
  it("配置没变：同一目录反复读、同时读都只跑一次 omp", async () => {
    const { project, runs, cache } = await setup("same");
    const [first, second] = await Promise.all([cache.list(project), cache.list(project)]);
    expect(await cache.list(project)).toBe(first);
    expect(second).toBe(first);
    expect(runs).toHaveLength(1);
  });

  it("agent 目录的 config.yml 或项目的 .omp/config.yml 变了：下一次读重跑", async () => {
    const { agentDir, project, runs, cache } = await setup("changed");
    await cache.list(project);
    await utimes(path.join(agentDir, "config.yml"), later(60), later(60));
    expect(await cache.list(project)).toEqual({ "tools.approvalMode": { value: "run 2" } });

    await mkdir(path.join(project, ".omp"));
    await writeFile(path.join(project, ".omp", "config.yml"), "tools:\n  approvalMode: yolo\n");
    await cache.list(project);
    expect(runs).toHaveLength(3);
    await cache.list(project);
    expect(runs).toHaveLength(3);
  });

  it("项目的 .omp/settings.json（omp 也读它）变了：下一次读重跑", async () => {
    const { project, runs, cache } = await setup("legacy");
    await mkdir(path.join(project, ".omp"));
    await cache.list(project);
    await writeFile(path.join(project, ".omp", "settings.json"), '{"tools":{"approvalMode":"yolo"}}');
    await cache.list(project);
    await cache.list(project);
    expect(runs).toHaveLength(2);
  });

  it("目录多了只丢最久没用的：常用的项目不因开过很多 worktree 被挤掉", async () => {
    const { project, runs, cache } = await setup("many");
    const worktrees = await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        const dir = path.join(scratch, "many", `worktree-${i}`);
        await mkdir(dir);
        return dir;
      }),
    );
    await cache.list(project);
    for (const dir of worktrees) {
      await cache.list(dir);
      await cache.list(project);
    }
    expect(runs.filter((dir) => dir === project)).toHaveLength(1);
    await cache.list(worktrees[0]!);
    expect(runs.filter((dir) => dir === worktrees[0])).toHaveLength(2);
  });

  it("studio 写配置（clear）之后的读重跑；目录之间互不影响", async () => {
    const { project, runs, cache } = await setup("cleared");
    const other = path.join(scratch, "cleared", "另一个");
    await mkdir(other);
    await cache.list(project);
    await cache.list(other);
    cache.clear();
    await cache.list(project);
    await cache.list(project);
    expect(runs).toEqual([project, other, project]);
  });

  it("失败的不留：下一次读重跑", async () => {
    const { project, runs, cache, failNext } = await setup("failed");
    failNext(true);
    await expect(cache.list(project)).rejects.toThrow("omp config list failed");
    failNext(false);
    await cache.list(project);
    await cache.list(project);
    expect(runs).toHaveLength(2);
  });
});
