// 防：给角色指定模型时弄丢别的角色、写出空映射，或读默认值时没读到项目目录里生效的值。
import { describe, expect, it } from "vitest";
import {
  readModelDefaults,
  readModelRoles,
  writeModelRole,
  type ModelDefaultsDeps,
} from "../src/main/omp-config/model-defaults.ts";

const model = { provider: "deepseek", modelId: "deepseek-v4-flash" };

/** 假的 omp config：项目目录里看到 projectValues 盖在 globalValues 上，别处只看到 globalValues；记录全局写入。 */
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

describe("给角色指定模型", () => {
  it("写全局，只换目标角色，其它角色原样保留", async () => {
    const omp = fakeOmp({ modelRoles: { smol: "openai/gpt-4.1-mini", task: "c/d:high" } }, {});
    await writeModelRole(omp.deps, "default", model);
    expect(omp.writes).toEqual([
      { smol: "openai/gpt-4.1-mini", task: "c/d:high", default: "deepseek/deepseek-v4-flash" },
    ]);
  });

  it("以全局角色表为底：项目里自带的角色不会被抄进全局", async () => {
    const omp = fakeOmp(
      { modelRoles: { default: "a/b" } },
      { modelRoleStorage: "project", modelRoles: { default: "x/y", plan: "p/q" } },
    );
    await writeModelRole(omp.deps, "smol", model);
    expect(omp.writes).toEqual([{ default: "a/b", smol: "deepseek/deepseek-v4-flash" }]);
  });

  it("去掉唯一的角色时 reset，而不是写一个空对象", async () => {
    const omp = fakeOmp({ modelRoles: { default: "deepseek/deepseek-v4-pro" } }, {});
    await writeModelRole(omp.deps, "default", null);
    expect(omp.writes).toEqual([null]);
  });
});

describe("读默认值和角色表", () => {
  it("读角色表只留字符串值", async () => {
    const omp = fakeOmp({ modelRoles: { default: "a/b", odd: 3 } }, {});
    expect(await readModelRoles(omp.deps, null)).toEqual({ default: "a/b" });
  });

  it("读到的是项目目录里生效的值", async () => {
    const omp = fakeOmp(
      { modelRoles: { default: "g/m" }, defaultThinkingLevel: "high" },
      { modelRoles: { default: "p/m:low" } },
    );
    expect(await readModelDefaults(omp.deps, "C:\\proj")).toEqual({ model: "p/m:low", thinkingLevel: "high" });
    expect(await readModelDefaults(omp.deps, null)).toEqual({ model: "g/m", thinkingLevel: "high" });
  });
});
