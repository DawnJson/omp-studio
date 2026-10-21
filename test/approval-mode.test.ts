// 防：胶囊只看全局配置（项目设了 always-ask 却显示"全部自动"）、项目覆盖时来源判错、
// 第 4 档 always-ask-cached 没被认出来，以及项目 config.yml 解析不了时被当成"没设"。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { approvalModes, toApprovalMode } from "../src/shared/approval-mode.ts";
import { dictionaries } from "../src/shared/i18n/index.ts";
import { enumLabel } from "../src/shared/ui/config-labels.ts";
import { readApprovalMode, type ApprovalModeDeps } from "../src/main/omp-config/approval-mode.ts";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function project(configYml: string | null): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "omp-studio 项目 审批-"));
  dirs.push(dir);
  if (configYml !== null) {
    await mkdir(path.join(dir, ".omp"));
    await writeFile(path.join(dir, ".omp", "config.yml"), configYml);
  }
  return dir;
}

/** 假的 omp config：项目目录里看到项目值（盖过全局），别处看到全局值。 */
function fakeOmp(globalMode: unknown, projectMode: unknown = undefined) {
  const deps: ApprovalModeDeps = {
    list: async (cwd) => ({
      "tools.approvalMode": { value: cwd !== null && projectMode !== undefined ? projectMode : globalMode },
    }),
  };
  return { deps };
}

describe("审批模式的取值", () => {
  it("四档都认识，omp 没见过的值是 null", () => {
    expect(approvalModes).toEqual(["always-ask", "always-ask-cached", "write", "yolo"]);
    for (const mode of approvalModes) expect(toApprovalMode(mode)).toBe(mode);
    expect(toApprovalMode("always-ask-cached")).toBe("always-ask-cached");
    expect(toApprovalMode("paranoid")).toBeNull();
    expect(toApprovalMode(undefined)).toBeNull();
  });

  it("第 4 档在设置页取值和胶囊里用同一套文案，两种语言都有", () => {
    for (const locale of ["zh-CN", "en"] as const) {
      const approval = dictionaries[locale]["approval"] as Record<string, string>;
      expect(approval["alwaysAskCached"]).toBeTruthy();
      expect(approval["desc.alwaysAskCached"]).toBeTruthy();
      expect(enumLabel(locale, "tools.approvalMode", "always-ask-cached")).toBe(approval["alwaysAskCached"]);
    }
    expect(enumLabel("zh-CN", "tools.approvalMode", "always-ask-cached")).toBe("每次询问并记住");
  });
});

describe("读生效的审批模式", () => {
  it("没有项目（null）：全局值，来源 global", async () => {
    expect(await readApprovalMode(fakeOmp("write").deps, null)).toEqual({ mode: "write", source: "global" });
  });

  it("项目没有 .omp/config.yml：全局值，来源 global", async () => {
    const dir = await project(null);
    expect(await readApprovalMode(fakeOmp("yolo").deps, dir)).toEqual({ mode: "yolo", source: "global" });
  });

  it("项目配置设了 always-ask：显示项目的值，来源 project（不是全局的 yolo）", async () => {
    const dir = await project("tools:\n  approvalMode: always-ask\n");
    expect(await readApprovalMode(fakeOmp("yolo", "always-ask").deps, dir)).toEqual({
      mode: "always-ask",
      source: "project",
    });
  });

  it("项目配置设了第 4 档", async () => {
    const dir = await project("tools:\n  approvalMode: always-ask-cached\n");
    expect(await readApprovalMode(fakeOmp("yolo", "always-ask-cached").deps, dir)).toEqual({
      mode: "always-ask-cached",
      source: "project",
    });
  });

  it("项目配置存在但没设 tools.approvalMode：来源 global", async () => {
    const dir = await project("tools:\n  bash: true\nmodelRoles:\n  default: a/b\n");
    expect(await readApprovalMode(fakeOmp("write").deps, dir)).toEqual({ mode: "write", source: "global" });
  });

  it("omp 给了不认识的值：mode 为 null，不当成别的档位", async () => {
    expect(await readApprovalMode(fakeOmp("paranoid").deps, null)).toEqual({ mode: null, source: "global" });
  });

  it("项目 config.yml 解析不了就报错，不当成没设", async () => {
    const dir = await project("tools: [unclosed\n");
    await expect(readApprovalMode(fakeOmp("yolo").deps, dir)).rejects.toThrow("config.yml");
  });
});
