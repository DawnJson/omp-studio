// 输入框的文件附件（主进程登记表 + 占位符换成 omp 的 @"路径" 提及）：渲染进程只拿 id，路径在这里校验。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileSlot, fillFileSlots } from "../src/shared/composer-files.ts";
import { registerComposerFiles, resolveComposerFiles } from "../src/main/files/composer-files.ts";

let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "omp composer files-"));
  await mkdir(path.join(dir, "子 目录"));
  await writeFile(path.join(dir, "报告 final.txt"), "hello");
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe("登记", () => {
  it("普通文件换成 id + 名字 + 大小（路径带空格和中文）；目录、不存在、相对路径、含引号的路径原样退回", async () => {
    const file = path.join(dir, "报告 final.txt");
    const { files, rest } = await registerComposerFiles([
      file,
      path.join(dir, "子 目录"),
      path.join(dir, "不存在.txt"),
      "relative/a.txt",
      `${file}"x`,
    ]);
    expect(files).toEqual([{ id: expect.any(String), name: "报告 final.txt", size: 5 }]);
    expect(rest).toHaveLength(4);
    expect(await resolveComposerFiles([files[0]!.id])).toEqual([file]);
  });
  it("没登记过的 id 不能换出路径；文件后来被删了也不能", async () => {
    await expect(resolveComposerFiles(["not-registered"])).rejects.toThrow(/no longer available/);
    const gone = path.join(dir, "gone.txt");
    await writeFile(gone, "x");
    const { files } = await registerComposerFiles([gone]);
    await rm(gone);
    await expect(resolveComposerFiles([files[0]!.id])).rejects.toThrow(/gone/);
  });
});

describe('占位符 → @"路径"', () => {
  it("编号对应 paths 的下标，反斜杠换成正斜杠，路径用引号包起来", () => {
    const text = `看 ${fileSlot(2)} 和 ${fileSlot(1)}，再看 ${fileSlot(3)}`;
    expect(fillFileSlots(text, ["C:\\a b\\x.txt", "/tmp/y.md"])).toBe(
      `看 @"/tmp/y.md" 和 @"C:/a b/x.txt"，再看 ${fileSlot(3)}`,
    );
  });
});
