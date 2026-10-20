// 防：默认模型写错层（项目设了 modelRoleStorage: project 却写全局，或反过来），以及改项目 config.yml 时
// 弄丢用户的注释、别的键或别的角色。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readModelDefaults,
  readModelRoles,
  writeModelRole,
  type ModelDefaultsDeps,
} from "../src/main/omp-config/model-defaults.ts";

const model = { provider: "deepseek", modelId: "deepseek-v4-flash" };
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function project(configYml: string | null): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "omp-studio 项目 默认模型-"));
  dirs.push(dir);
  if (configYml !== null) {
    await mkdir(path.join(dir, ".omp"));
    await writeFile(path.join(dir, ".omp", "config.yml"), configYml);
  }
  return dir;
}

/** 假的 omp config：项目目录里看到 projectValues，别处看到 globalValues；记录全局写入。 */
function fakeOmp(globalValues: Record<string, unknown>, projectValues: Record<string, unknown>) {
  const writes: (Record<string, unknown> | null)[] = [];
  const wrap = (values: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }]));
  const deps: ModelDefaultsDeps = {
    list: async (cwd) => wrap(cwd === null ? globalValues : { ...globalValues, ...projectValues }),
    setGlobalRoles: async (roles) => {
      writes.push(roles);
    },
  };
  return { deps, writes };
}

describe("默认模型写到哪一层", () => {
  it("modelRoleStorage 是 global（omp 默认）时写全局，只换 default，保留其它角色", async () => {
    const dir = await project("modelRoles:\n  default: deepseek/deepseek-v4-pro\n");
    const omp = fakeOmp({ modelRoles: { smol: "openai/gpt-4.1-mini" } }, { modelRoles: { default: "x/y" } });
    await writeModelRole(omp.deps, dir, "default", model);
    expect(omp.writes).toEqual([{ smol: "openai/gpt-4.1-mini", default: "deepseek/deepseek-v4-flash" }]);
    expect(await readFile(path.join(dir, ".omp", "config.yml"), "utf8")).toBe(
      "modelRoles:\n  default: deepseek/deepseek-v4-pro\n",
    );
  });

  it("项目生效的 modelRoleStorage 是 project 时只改项目文件，注释和其它键原样保留", async () => {
    const dir = await project(
      "# 团队约定\nmodelRoleStorage: project\nmodelRoles:\n  default: deepseek/deepseek-v4-pro # 旧的\n  smol: a/b\ncompaction:\n  enabled: false\n",
    );
    const omp = fakeOmp({}, { modelRoleStorage: "project" });
    await writeModelRole(omp.deps, dir, "default", model);
    expect(omp.writes).toEqual([]);
    const text = await readFile(path.join(dir, ".omp", "config.yml"), "utf8");
    expect(text).toContain("# 团队约定");
    expect(text).toContain("default: deepseek/deepseek-v4-flash");
    expect(text).toContain("smol: a/b");
    expect(text).toContain("compaction:\n  enabled: false");
  });

  it("全局里设 modelRoleStorage: project、项目还没有 .omp 时新建项目文件", async () => {
    const dir = await project(null);
    const omp = fakeOmp({ modelRoleStorage: "project" }, {});
    await writeModelRole(omp.deps, dir, "default", model);
    expect(await readFile(path.join(dir, ".omp", "config.yml"), "utf8")).toBe(
      "modelRoles:\n  default: deepseek/deepseek-v4-flash\n",
    );
  });

  it("项目里去掉 default 后角色表空了，就删掉整个 modelRoles，不留空映射盖住全局", async () => {
    const dir = await project("modelRoleStorage: project\nmodelRoles:\n  default: deepseek/deepseek-v4-pro\n");
    const omp = fakeOmp({}, { modelRoleStorage: "project" });
    await writeModelRole(omp.deps, dir, "default", null);
    expect(await readFile(path.join(dir, ".omp", "config.yml"), "utf8")).toBe("modelRoleStorage: project\n");
  });

  it("全局去掉唯一的 default 时 reset，而不是写一个空对象", async () => {
    const omp = fakeOmp({ modelRoles: { default: "deepseek/deepseek-v4-pro" } }, {});
    await writeModelRole(omp.deps, null, "default", null);
    expect(omp.writes).toEqual([null]);
  });

  it("给 task 角色指定模型：全局只换 task，别的角色（含 default）不动", async () => {
    const omp = fakeOmp({ modelRoles: { default: "a/b", task: "c/d:high" } }, {});
    await writeModelRole(omp.deps, null, "task", model);
    expect(omp.writes).toEqual([{ default: "a/b", task: "deepseek/deepseek-v4-flash" }]);
  });

  it("项目存储下给 plan 角色指定模型，不碰 default", async () => {
    const dir = await project("modelRoleStorage: project\nmodelRoles:\n  default: a/b\n");
    const omp = fakeOmp({}, { modelRoleStorage: "project" });
    await writeModelRole(omp.deps, dir, "plan", model);
    expect(await readFile(path.join(dir, ".omp", "config.yml"), "utf8")).toBe(
      "modelRoleStorage: project\nmodelRoles:\n  default: a/b\n  plan: deepseek/deepseek-v4-flash\n",
    );
  });

  it("读角色表只留字符串值", async () => {
    const omp = fakeOmp({ modelRoles: { default: "a/b", odd: 3 } }, {});
    expect(await readModelRoles(omp.deps, null)).toEqual({ default: "a/b" });
  });

  it("读到的是项目目录里生效的值", async () => {
    const omp = fakeOmp(
      { modelRoles: { default: "g/m" }, defaultThinkingLevel: "high" },
      { modelRoles: { default: "p/m:low" }, modelRoleStorage: "project" },
    );
    expect(await readModelDefaults(omp.deps, "C:\\proj")).toEqual({
      model: "p/m:low",
      thinkingLevel: "high",
      storage: "project",
    });
    expect(await readModelDefaults(omp.deps, null)).toEqual({ model: "g/m", thinkingLevel: "high", storage: "global" });
  });
});
