// 斜杠命令列表的按目录缓存（service/slash-commands.ts，存在启动缓存里）：数"起项目 omp 取列表"的次数。
// 已经取过的目录、输入没变：打开任务、敲 "/"、重启 studio 之后都不再起 omp；新建 skill / 命令、改配置、omp 升级之后下一次要重取。
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AvailableSlashCommand } from "../src/shared/omp-wire/rpc-wire.generated.ts";
import { inputStamp } from "../src/main/service/input-stamp.ts";
import { SlashCommandCache, slashCommandInputs } from "../src/main/service/slash-commands.ts";
import { StartupCache } from "../src/main/service/startup-cache.ts";
import { writeFileAtomic } from "../src/main/tasks/atomic-write.ts";

let scratch: string;
beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio 斜杠缓存-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const commands = (...names: string[]) =>
  names.map((name) => ({ name, description: `${name} 的说明` })) as unknown as AvailableSlashCommand[];

async function setup(name: string) {
  const root = path.join(scratch, name);
  const home = path.join(root, "home");
  const agentDir = path.join(home, ".omp", "agent");
  const project = path.join(root, "项目");
  await mkdir(path.join(agentDir, "skills"), { recursive: true });
  await mkdir(project, { recursive: true });
  const file = path.join(root, "startup-cache.json");
  const state = { version: "18.13.3", fetches: 0, list: commands("model", "compact") };
  const open = () => {
    const store = new StartupCache({
      file,
      write: (target, text) => writeFileAtomic(target, text, "test"),
      warn: () => {},
    });
    const cache = new SlashCommandCache({
      stamp: async (dir) =>
        inputStamp(state.version, await slashCommandInputs(dir, agentDir, path.join(home, ".omp"), home)),
      key: (dir) => dir,
      cache: store,
    });
    return { cache, store };
  };
  const fetch = async () => {
    state.fetches++;
    return state.list;
  };
  return { home, agentDir, project, state, open, fetch };
}

describe("SlashCommandCache", () => {
  it("取过的目录输入没变：再要（打开任务、敲 /）不起 omp；重启 studio 后照样用上次的", async () => {
    const { project, state, open, fetch } = await setup("hit");
    const { cache, store } = open();
    expect(await cache.list(project, fetch)).toEqual(state.list);
    expect(await cache.list(project, fetch)).toEqual(state.list);
    expect(state.fetches).toBe(1);

    // 写完盘后另开一份，等于重启 studio。
    await store.flushed();
    expect(await open().cache.list(project, fetch)).toEqual(state.list);
    expect(state.fetches).toBe(1);
  });

  it("项目里新建 skill、命令，或改了项目配置：下一次重取", async () => {
    const { project, state, open, fetch } = await setup("project");
    const { cache } = open();
    await cache.list(project, fetch);
    await mkdir(path.join(project, ".omp", "skills", "新技能"), { recursive: true });
    await cache.list(project, fetch);
    expect(state.fetches).toBe(2);

    await mkdir(path.join(project, ".claude", "commands"), { recursive: true });
    await cache.list(project, fetch);
    expect(state.fetches).toBe(3);

    await writeFile(path.join(project, ".omp", "config.yml"), "skills:\n  enableSkillCommands: true\n");
    await cache.list(project, fetch);
    await cache.list(project, fetch);
    expect(state.fetches).toBe(4);
  });

  it("用户级 skill、agent 的 config.yml、omp 版本变了：下一次重取", async () => {
    const { agentDir, project, state, open, fetch } = await setup("user");
    const { cache } = open();
    await cache.list(project, fetch);
    await mkdir(path.join(agentDir, "skills", "global-skill"));
    await cache.list(project, fetch);
    expect(state.fetches).toBe(2);

    await writeFile(path.join(agentDir, "config.yml"), "x: 1\n");
    await cache.list(project, fetch);
    const later = new Date(Date.now() + 60_000);
    await utimes(path.join(agentDir, "config.yml"), later, later);
    await cache.list(project, fetch);
    expect(state.fetches).toBe(4);

    state.version = "18.14.0";
    await cache.list(project, fetch);
    await cache.list(project, fetch);
    expect(state.fetches).toBe(5);
  });

  it("加了 MCP 服务器（用户级、项目级 mcp.json）：下一次重取（MCP prompt 也是斜杠命令）", async () => {
    const { agentDir, project, state, open, fetch } = await setup("mcp");
    const { cache } = open();
    await cache.list(project, fetch);
    await writeFile(path.join(agentDir, "mcp.json"), '{"mcpServers":{}}');
    await cache.list(project, fetch);
    expect(state.fetches).toBe(2);

    await mkdir(path.join(project, ".omp"));
    await writeFile(path.join(project, ".omp", "mcp.json"), '{"mcpServers":{}}');
    await cache.list(project, fetch);
    await cache.list(project, fetch);
    expect(state.fetches).toBe(3);
  });

  it("在 .claude/commands 已有的子目录里新建命令：下一次重取（这个目录是递归扫的）", async () => {
    const { project, state, open, fetch } = await setup("claude-nested");
    const nested = path.join(project, ".claude", "commands", "团队");
    await mkdir(nested, { recursive: true });
    const { cache } = open();
    await cache.list(project, fetch);
    await writeFile(path.join(nested, "review.md"), "review\n");
    await cache.list(project, fetch);
    await cache.list(project, fetch);
    expect(state.fetches).toBe(2);
  });

  it("omp 推来的新列表记下，之后直接用它；空列表不记", async () => {
    const { project, state, open, fetch } = await setup("pushed");
    const { cache } = open();
    state.list = [];
    expect(await cache.list(project, fetch)).toEqual([]);
    await cache.list(project, fetch);
    expect(state.fetches).toBe(2);

    const pushed = commands("model", "compact", "skill:新技能");
    await cache.remember(project, pushed);
    expect(await cache.list(project, fetch)).toEqual(pushed);
    expect(state.fetches).toBe(2);
  });
});
