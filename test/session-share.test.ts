import { describe, expect, it } from "vitest";
import { parseShareOutput, shareErrorMessage } from "../src/shared/omp-output/share.ts";
import { readShareSettings, shareSession, ShareError } from "../src/main/session-info/share.ts";

// 全部样本来自 omp 18.12.5 的 `omp share`，对着本机 127.0.0.1 上的假 share 服务器实测（没有连任何真实服务器，没有真的上传）。
const SUCCESS = "Share URL: http://127.0.0.1:7799/s/a1b2c3d4e5f60718#rwAG6C8OAWZ5Rs5ZixNdpeYesldVYT3QKtJ_XEE4l5Q\n";
const FAILURE_STDERR = `545 |     const a = (await e.text().catch(() => "")).trim().slice(0, 200);
546 |     throw new Error(\`Share upload to \${t} failed: HTTP \${e.status}\${a ? \` (\${a})\` : ""}\`);
547 |   }
548 |   const n = await e.json().catch(() => null);
549 |   const s = n && typeof n.id === "string" ? n.id : "";
550 |     throw new Error(\`Share upload to \${t} failed: server returned no usable id\`);
                ^
error: Share upload to http://127.0.0.1:7799/s failed: server returned no usable id
      at Y (B:/~BUN/root/chunks/cli-9vh2v32c.js:550:11)
      at async _ (B:/~BUN/root/chunks/cli-9vh2v32c.js:524:20)
`;

describe("parseShareOutput", () => {
  it("实测成功输出：一行 `Share URL: <server>/<id>#<key>`", () => {
    expect(parseShareOutput(SUCCESS)).toEqual({
      url: "http://127.0.0.1:7799/s/a1b2c3d4e5f60718#rwAG6C8OAWZ5Rs5ZixNdpeYesldVYT3QKtJ_XEE4l5Q",
      gistUrl: null,
      text: SUCCESS,
    });
  });

  it("CRLF、前后空白、大小写不敏感的标签；链接前后的别的行（截断说明等）不影响", () => {
    const text =
      "Snapshot trimmed to fit.\r\n  share url:  https://my.omp.sh/s/ab12#key  \r\nGist URL: https://gist.github.com/me/abc123\r\n";
    expect(parseShareOutput(text)).toMatchObject({
      url: "https://my.omp.sh/s/ab12#key",
      gistUrl: "https://gist.github.com/me/abc123",
    });
  });

  it("认不出链接：url 为 null，原文原样返回（界面显示它）；非 http(s) 的链接不接受", () => {
    expect(parseShareOutput("Session shared\n")).toEqual({ url: null, gistUrl: null, text: "Session shared\n" });
    expect(parseShareOutput("Share URL: javascript:alert(1)\n").url).toBeNull();
    expect(parseShareOutput("Share URL: file:///C:/secret\n").url).toBeNull();
    expect(parseShareOutput("").url).toBeNull();
  });
});

describe("shareErrorMessage", () => {
  it("取 stderr 里的 `error:` 行并去掉前缀（实测的 Bun 堆栈输出）", () => {
    expect(shareErrorMessage(FAILURE_STDERR)).toBe(
      "Share upload to http://127.0.0.1:7799/s failed: server returned no usable id",
    );
  });

  it("没有 error: 行就取最后一个非空行；空输出给空串；超长截断", () => {
    expect(shareErrorMessage("one\ntwo\n\n")).toBe("two");
    expect(shareErrorMessage("")).toBe("");
    expect(shareErrorMessage(`error: ${"x".repeat(1000)}`)).toHaveLength(400);
  });
});

describe("shareSession（假 omp：只回放上面的实测输出，不上传）", () => {
  it("参数是数组：share <会话文件>，gist 时追加 --gist；成功返回解析结果", async () => {
    const calls: string[][] = [];
    const run = async (args: string[]) => {
      calls.push(args);
      return { code: 0, stdout: SUCCESS, stderr: "" };
    };
    const file = "C:\\work 项目\\s.jsonl";
    const plain = await shareSession(run, file, false);
    expect(plain.url).toBe("http://127.0.0.1:7799/s/a1b2c3d4e5f60718#rwAG6C8OAWZ5Rs5ZixNdpeYesldVYT3QKtJ_XEE4l5Q");
    await shareSession(run, file, true);
    expect(calls).toEqual([
      ["share", file],
      ["share", file, "--gist"],
    ]);
  });

  it("非 0 退出：抛 ShareError，消息是 omp 的错误行；stderr 为空时说明退出码", async () => {
    await expect(
      shareSession(async () => ({ code: 1, stdout: "", stderr: FAILURE_STDERR }), "f", false),
    ).rejects.toThrow("Share upload to http://127.0.0.1:7799/s failed: server returned no usable id");
    await expect(shareSession(async () => ({ code: 2, stdout: "", stderr: "" }), "f", false)).rejects.toBeInstanceOf(
      ShareError,
    );
    await expect(shareSession(async () => ({ code: 2, stdout: "", stderr: "" }), "f", false)).rejects.toThrow(
      "exited with code 2",
    );
  });
});

describe("readShareSettings（omp config list --json 的 share.* 三项）", () => {
  it("实测的默认值", () => {
    expect(
      readShareSettings({
        "share.serverUrl": { value: "https://my.omp.sh/s", type: "string" },
        "share.store": { value: "blob", type: "enum" },
        "share.redactSecrets": { value: true, type: "boolean" },
      }),
    ).toEqual({ serverUrl: "https://my.omp.sh/s", store: "blob", redactSecrets: true });
  });

  it("自定义服务器、gist、关闭脱敏", () => {
    expect(
      readShareSettings({
        "share.serverUrl": { value: "https://share.example.test/s" },
        "share.store": { value: "gist" },
        "share.redactSecrets": { value: false },
      }),
    ).toEqual({ serverUrl: "https://share.example.test/s", store: "gist", redactSecrets: false });
  });

  it("缺键或形状不对时用 omp 文档里的默认值（脱敏默认开）", () => {
    expect(readShareSettings({})).toEqual({ serverUrl: "https://my.omp.sh/s", store: "blob", redactSecrets: true });
    expect(readShareSettings(null)).toEqual({ serverUrl: "https://my.omp.sh/s", store: "blob", redactSecrets: true });
  });
});
