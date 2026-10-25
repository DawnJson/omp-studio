import { afterEach, describe, expect, it } from "vitest";
import { fixLoginPath, mergePaths, parseLoginPath } from "../src/main/platform/darwin/login-path.ts";

const START = "__OMP_STUDIO_PATH_START__";
const END = "__OMP_STUDIO_PATH_END__";

describe("parseLoginPath", () => {
  it("取标记之间的内容，前后的 motd、nvm 提示等杂质丢掉", () => {
    const output = `Last login: Sat Oct 25\nnvm: using v22\n${START}/opt/homebrew/bin:/usr/bin${END}\nbye\n`;
    expect(parseLoginPath(output)).toBe("/opt/homebrew/bin:/usr/bin");
  });

  it("rc 文件把命令输出了两遍：用最后一对", () => {
    expect(parseLoginPath(`${START}/a${END}${START}/a:/b${END}`)).toBe("/a:/b");
  });

  it("没有标记、只有一个标记、顺序反了：返回 null", () => {
    expect(parseLoginPath("/usr/bin:/bin\n")).toBeNull();
    expect(parseLoginPath(`${START}/usr/bin`)).toBeNull();
    expect(parseLoginPath(`${END}/usr/bin${START}`)).toBeNull();
  });

  it("标记之间是空的或只有空白：返回 null，不会把 PATH 清空", () => {
    expect(parseLoginPath(`${START}${END}`)).toBeNull();
    expect(parseLoginPath(`${START}  \n${END}`)).toBeNull();
  });
});

describe("mergePaths", () => {
  it("登录 shell 的条目在前，原 PATH 里没有的条目接在后面", () => {
    expect(mergePaths("/opt/homebrew/bin:/usr/bin", "/usr/bin:/bin:/usr/sbin")).toBe(
      "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin",
    );
  });

  it("重复条目只留第一个，空条目丢掉", () => {
    expect(mergePaths("/a::/b:/a", "/b::/c")).toBe("/a:/b:/c");
  });

  it("原 PATH 没设置时就是登录 shell 的 PATH", () => {
    expect(mergePaths("/a:/b", undefined)).toBe("/a:/b");
  });
});

describe("fixLoginPath", () => {
  const original = process.env["PATH"];
  afterEach(() => {
    process.env["PATH"] = original;
  });

  it("非 darwin 什么也不做（不起 shell，PATH 不变）", async () => {
    process.env["PATH"] = "/only/this";
    await fixLoginPath("win32");
    await fixLoginPath("linux");
    expect(process.env["PATH"]).toBe("/only/this");
  });
});
