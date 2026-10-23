import { describe, expect, it } from "vitest";
import { detectShellPrefix, setShellExcluded } from "../src/shared/ui/shell-prefix.ts";

describe("输入框的 shell 前缀（omp 18.12.6 input-controller 的判定）", () => {
  it("! 是 bash、进上下文；!! 是 bash、不进上下文", () => {
    expect(detectShellPrefix("!ls -la")).toEqual({ kind: "shell", excluded: false, indent: "", rest: "ls -la" });
    expect(detectShellPrefix("!!ls")).toEqual({ kind: "shell", excluded: true, indent: "", rest: "ls" });
  });

  it("前缀前的空白不影响判断，切换时保留", () => {
    expect(detectShellPrefix("  !echo x")?.kind).toBe("shell");
    expect(setShellExcluded("  !echo x", true)).toBe("  !!echo x");
  });

  it("$ / $$ 后面必须紧跟空白才是 Python", () => {
    expect(detectShellPrefix("$ print(1)")).toEqual({ kind: "python", excluded: false, indent: "", rest: " print(1)" });
    expect(detectShellPrefix("$$ print(1)")?.excluded).toBe(true);
    expect(detectShellPrefix("$HOME")).toBeNull();
    expect(detectShellPrefix("$$x")).toBeNull();
    expect(detectShellPrefix("$\nprint(1)")?.kind).toBe("python");
  });

  it("单个 $ 后面像 shell 命令的（终端提示符）不算 Python，$$ 不受影响", () => {
    expect(detectShellPrefix("$ git status")).toBeNull();
    expect(detectShellPrefix("$ cd ..")).toBeNull();
    expect(detectShellPrefix("$ ./run.sh")).toBeNull();
    expect(detectShellPrefix("$ cat a | wc -l")).toBeNull();
    expect(detectShellPrefix("$ echo hi > out.txt")).toBeNull();
    expect(detectShellPrefix("$ in: 12 out: 3 t: 1.2s tok/s: 40")).toBeNull();
    expect(detectShellPrefix("$$ git status")?.kind).toBe("python");
    // "go" 要整词匹配：`gofoo` 不是 go 命令
    expect(detectShellPrefix("$ gofoo = 1")?.kind).toBe("python");
  });

  it("普通消息和斜杠命令没有前缀", () => {
    expect(detectShellPrefix("hello !x")).toBeNull();
    expect(detectShellPrefix("/todo")).toBeNull();
    expect(detectShellPrefix("")).toBeNull();
  });

  it("切换单双前缀只改前缀", () => {
    expect(setShellExcluded("!ls", true)).toBe("!!ls");
    expect(setShellExcluded("!!ls", false)).toBe("!ls");
    expect(setShellExcluded("$ x = 1\ny = 2", true)).toBe("$$ x = 1\ny = 2");
    expect(setShellExcluded("$$ x = 1", false)).toBe("$ x = 1");
    // 已经是目标状态、不是命令：原样
    expect(setShellExcluded("!ls", false)).toBe("!ls");
    expect(setShellExcluded("hello", true)).toBe("hello");
  });
});
