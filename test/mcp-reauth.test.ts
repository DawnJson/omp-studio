// MCP 登录（main/integrations/mcp-reauth.ts）：专用 rpc-ui 上发 `/mcp reauth <name>`，按 command_output 出结果，结果出来前先关进程。
// 连接用假的：按 omp 19.2.1 实测的顺序推 command_output（应答先回，输出后到）。
import { describe, expect, it, vi } from "vitest";
import { McpReauth, type ReauthConnection } from "../src/main/integrations/mcp-reauth.ts";
import type { RpcServerFrame } from "../src/shared/omp-wire/rpc-wire.generated.ts";

function fakeConnection(agentInvoked: boolean | undefined = false) {
  const listeners = new Set<(frame: RpcServerFrame) => void>();
  const exit = Promise.withResolvers<void>();
  const prompts: string[] = [];
  const connection: ReauthConnection & { closed: boolean } = {
    closed: false,
    onFrame: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    prompt: async (message) => {
      prompts.push(message);
      return agentInvoked;
    },
    exited: exit.promise,
    close: async () => {
      connection.closed = true;
      exit.resolve();
    },
  };
  const output = (text: string) => {
    for (const listener of listeners) listener({ type: "command_output", text } as RpcServerFrame);
  };
  return { connection, prompts, output };
}

const URL_TEXT =
  "━━━ OAuth Authorization Required ━━━\nOpening your browser to authorize. If it did not open:\nhttps://github.com/login/oauth/authorize?state=1";

describe("McpReauth", () => {
  it("发 /mcp reauth，授权地址交出去，成功的原话是结果，结果出来时进程已关", async () => {
    const fake = fakeConnection();
    const onUrl = vi.fn();
    const reauth = new McpReauth({ spawn: async () => fake.connection, onUrl });
    const outcome = reauth.start("github", "C:/proj");
    await vi.waitFor(() => expect(fake.prompts).toEqual(["/mcp reauth github"]));
    fake.output('Reauthorizing "github"… opening your browser (5 minute timeout).');
    fake.output(URL_TEXT);
    fake.output("Waiting for browser authentication...");
    expect(onUrl).toHaveBeenCalledWith("https://github.com/login/oauth/authorize?state=1");
    expect(fake.connection.closed).toBe(false);
    fake.output('✓ Reauthorized "github" (user config). Server reconnected.');
    await expect(outcome).resolves.toEqual({
      kind: "done",
      message: '✓ Reauthorized "github" (user config). Server reconnected.',
    });
    expect(fake.connection.closed).toBe(true);
  });

  it("取消：关进程，start 以 cancelled 结束；omp 的错误句是 failed", async () => {
    const first = fakeConnection();
    const reauth = new McpReauth({ spawn: async () => first.connection, onUrl: () => undefined });
    const cancelled = reauth.start("github", "C:/proj");
    await vi.waitFor(() => expect(first.prompts).toHaveLength(1));
    await reauth.cancel();
    await expect(cancelled).resolves.toEqual({ kind: "cancelled" });
    expect(first.connection.closed).toBe(true);

    const second = fakeConnection();
    const again = new McpReauth({ spawn: async () => second.connection, onUrl: () => undefined });
    const failed = again.start("nope", "C:/proj");
    await vi.waitFor(() => expect(second.prompts).toHaveLength(1));
    second.output('Server "nope" not found. Run /mcp list to see configured servers.');
    await expect(failed).resolves.toEqual({
      kind: "failed",
      message: 'Server "nope" not found. Run /mcp list to see configured servers.',
    });
  });

  it("omp 把命令当成了给模型的消息、进程中途退出、起不来：failed", async () => {
    const leaked = fakeConnection(true);
    await expect(
      new McpReauth({ spawn: async () => leaked.connection, onUrl: () => undefined }).start("github", "C:/p"),
    ).resolves.toMatchObject({ kind: "failed" });

    const dying = fakeConnection();
    const run = new McpReauth({ spawn: async () => dying.connection, onUrl: () => undefined }).start("github", "C:/p");
    await vi.waitFor(() => expect(dying.prompts).toHaveLength(1));
    await dying.connection.close();
    await expect(run).resolves.toEqual({ kind: "failed", message: "omp exited during the sign-in" });

    await expect(
      new McpReauth({
        spawn: () => Promise.reject(new Error("spawn failed")),
        onUrl: () => undefined,
      }).start("github", "C:/p"),
    ).resolves.toEqual({ kind: "failed", message: "spawn failed" });
  });
});
