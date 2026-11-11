// 文件类型图标的取名规则（src/renderer/src/ui/file-icon-name.ts）：文件名 > 多段扩展名 > 扩展名 > 通用文件；文件夹按名字，展开用 -open。
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileIconName } from "../src/renderer/src/ui/file-icon-name.ts";

const iconDir = path.join(import.meta.dirname, "..", "src", "renderer", "src", "ui", "file-icons");

describe("fileIconName", () => {
  it("整个文件名优先于扩展名，大小写不敏感", () => {
    expect(fileIconName("package.json", "file")).toBe("nodejs");
    expect(fileIconName("other.json", "file")).toBe("json");
    expect(fileIconName("README.md", "file")).toBe("readme");
    expect(fileIconName("Dockerfile", "file")).toBe("docker");
  });

  it("多段扩展名先于最后一段；认不出的落到通用文件", () => {
    expect(fileIconName("ipc.d.ts", "file")).toBe("typescript-def");
    expect(fileIconName("a.b.ts", "file")).toBe("typescript");
    expect(fileIconName("PHOTO.PNG", "file")).toBe("image");
    expect(fileIconName("notes.unknownext", "file")).toBe("file");
    expect(fileIconName("Makefile.bak", "file")).toBe("file");
    expect(fileIconName("noext", "file")).toBe("file");
  });

  it("文件夹按名字取图，展开换 -open，不认识的用通用文件夹；文件夹不看扩展名", () => {
    expect(fileIconName("src", "dir")).toBe("folder-src");
    expect(fileIconName("src", "dir", true)).toBe("folder-src-open");
    expect(fileIconName("my.ts", "dir")).toBe("folder");
    expect(fileIconName("whatever", "dir", true)).toBe("folder-open");
  });

  it("表里每个图名都有对应的 svg 文件", () => {
    const names = ["a.ts", "a.tsx", "a.py", "a.pdf", "a.d.ts", "LICENSE", ".env", "src", "docs", "node_modules"];
    for (const name of names) {
      for (const kind of ["file", "dir"] as const) {
        for (const open of [false, true]) {
          expect(existsSync(path.join(iconDir, `${fileIconName(name, kind, open)}.svg`))).toBe(true);
        }
      }
    }
  });
});
