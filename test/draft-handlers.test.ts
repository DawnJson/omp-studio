import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ userData: "" }));

// vi.mock 提升到导入之前，被测模块必须在 mock 之后才加载：这里只能动态导入。
vi.mock("electron", () => ({ app: { getPath: () => hoisted.userData } }));

const { draftHandlers, forgetDraft } = await import("../src/main/ipc/draft-handlers.ts");

describe("草稿随任务删除", () => {
  beforeAll(async () => {
    hoisted.userData = await mkdtemp(path.join(os.tmpdir(), "omp-studio-drafts-"));
  });
  afterAll(async () => {
    await rm(hoisted.userData, { recursive: true, force: true, maxRetries: 5 });
  });

  it("删掉任务的草稿后，攒满 300 条也不挡新任务存草稿", async () => {
    for (let i = 0; i < 300; i++) await draftHandlers.saveDraft(`task-${i}`, "text");
    await expect(draftHandlers.saveDraft("task-new", "text")).rejects.toThrow("too many drafts");

    await forgetDraft("task-0");
    expect(Object.keys(await draftHandlers.getDrafts())).not.toContain("task-0");
    await draftHandlers.saveDraft("task-new", "text");
    expect((await draftHandlers.getDrafts())["task-new"]).toBe("text");
  });
});
