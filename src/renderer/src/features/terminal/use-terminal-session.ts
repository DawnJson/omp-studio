// 一个终端面板的会话：创建 xterm、接主进程的 terminalData/terminalExit、把键盘输入和尺寸变化发回去。
// 面板卸载只释放 xterm，不结束主进程的 shell（隐藏面板 ≠ 杀进程）；下次挂载 openTerminal 返回 backlog 还原屏幕。
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { limits, type TerminalKey } from "../../../../shared/ipc.ts";
import { buildTerminalPalette, chunkInput, type PaletteToken } from "../../../../shared/ui/terminal-model.ts";
import { useT } from "../../i18n/use-t.ts";
import { describeError } from "../../ui/errors.ts";
import { takeFocusRequest } from "./terminal-store.ts";

export interface TerminalSession {
  shell: string | null;
  cwd: string | null;
  /** 已经开了终端但 shell 还没输出任何字节（比如 pwsh 在加载 profile）。 */
  starting: boolean;
  /** 结束当前 shell（如果还活着）并在同一目录新起一个。 */
  restart(): void;
}

type Phase = "opening" | "live" | "dead";

const resizeDebounceMs = 40;
/** 终端内容用的行高倍数；字号和字体取自 token，行高只对等宽字符网格有意义，不走 token。 */
const lineHeight = 1.2;
const scrollbackLines = 5000;

export function useTerminalSession(
  terminalKey: TerminalKey,
  host: RefObject<HTMLDivElement | null>,
  platform: "win32" | "darwin" | "linux",
): TerminalSession {
  const t = useT();
  const latestT = useRef(t);
  latestT.current = t;
  const [info, setInfo] = useState<{ shell: string; cwd: string } | null>(null);
  const restartRef = useRef<() => void>(() => undefined);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let phase: Phase = "opening";
    let buffered: string[] | null = [];
    let restarting = false;

    const term = new Terminal({
      scrollback: scrollbackLines,
      cursorBlink: false,
      lineHeight,
      minimumContrastRatio: 4.5,
      ...(platform === "win32" && { windowsPty: { backend: "conpty" as const } }),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);

    // 配色和字体取自设计 token：用一个探针元素让浏览器把 var(--x) 解析成 rgb()。
    const probe = document.createElement("span");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;width:0;height:0";
    el.parentElement?.append(probe);
    const readToken = (token: PaletteToken) => {
      probe.style.color = `var(${token})`;
      return getComputedStyle(probe).color;
    };
    const applyLook = () => {
      const css = getComputedStyle(document.documentElement);
      term.options.fontFamily = css.getPropertyValue("--font-mono").trim();
      term.options.fontSize = Number.parseFloat(css.getPropertyValue("--fs-code")) || 13;
      term.options.theme = buildTerminalPalette(readToken);
    };
    term.open(el);
    applyLook();
    const refit = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) fit.fit();
    };
    refit();

    const output = (data: string) => {
      // 第一个输出字节到了：shell 已经开始画东西（pwsh 加载 profile 要几秒），撤掉"正在启动"提示。
      if (data.length > 0) setStarting(false);
      if (buffered) buffered.push(data);
      else term.write(data);
    };
    const markDead = (message: string) => {
      phase = "dead";
      setStarting(false);
      // 灰色（ANSI 亮黑 = --text-3）的一行提示，按任意键重新启动。
      output(`\r\n\x1b[90m${message}\x1b[0m\r\n`);
    };

    const connect = async () => {
      phase = "opening";
      buffered = [];
      setStarting(true);
      const requested = { cols: term.cols, rows: term.rows };
      try {
        const result = await window.studio.openTerminal(terminalKey, requested.cols, requested.rows);
        if (disposed) return;
        const pending = buffered;
        buffered = null;
        if (result.reopened) {
          // backlog 已经包含 open 之前到达的输出，缓冲的那些丢掉，否则会重复。
          term.reset();
          term.write(result.backlog);
          if (result.backlog.length > 0) setStarting(false);
        } else {
          for (const data of pending) term.write(data);
        }
        // 打开期间 shell 就退出了（马上 exit）：保持 dead，按键即重启。
        if (phase === "opening") phase = "live";
        setInfo({ shell: result.shell, cwd: result.cwd });
        // 打开期间面板被拖动过：以最新尺寸为准。
        if (term.cols !== requested.cols || term.rows !== requested.rows) {
          void window.studio.resizeTerminal(terminalKey, term.cols, term.rows).catch(() => undefined);
        }
      } catch (error) {
        if (disposed) return;
        const pending = buffered ?? [];
        buffered = null;
        for (const data of pending) term.write(data);
        markDead(`${describeError(latestT.current, error)} · ${latestT.current("terminal.restartHint")}`);
      }
    };

    const restart = () => {
      if (restarting || disposed) return;
      restarting = true;
      void (async () => {
        try {
          await window.studio.closeTerminal(terminalKey);
          if (disposed) return;
          term.reset();
          await connect();
          // 点重启按钮时焦点在按钮上；重启后输入应该直接进新 shell。
          if (!disposed) term.focus();
        } finally {
          restarting = false;
        }
      })();
    };
    restartRef.current = restart;

    const offData = window.studio.onTerminalData((event) => {
      if (event.key === terminalKey) output(event.data);
    });
    const offExit = window.studio.onTerminalExit((event) => {
      if (event.key !== terminalKey) return;
      markDead(latestT.current("terminal.exited", { code: event.exitCode }));
    });

    const keys = term.onData((data) => {
      if (phase === "dead") {
        restart();
        return;
      }
      if (phase !== "live") return;
      for (const chunk of chunkInput(data, limits.terminalInputMaxChars)) {
        void window.studio
          .writeTerminal(terminalKey, chunk)
          .catch((error: unknown) => console.error("writeTerminal 失败", error));
      }
    });

    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const sizes = term.onResize(({ cols, rows }) => {
      if (phase !== "live") return;
      clearTimeout(resizeTimer);
      // ConPTY 每次 resize 都会重排，拖动面板时合并成最后一次。
      resizeTimer = setTimeout(() => {
        void window.studio.resizeTerminal(terminalKey, cols, rows).catch(() => undefined);
      }, resizeDebounceMs);
    });

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown" || event.altKey || event.metaKey) return true;
      const key = event.key.toLowerCase();
      // Ctrl+`：交给全局快捷键（回到输入框），xterm 不处理也不吞掉。
      if (event.ctrlKey && event.key === "`") return false;
      // 复制：Ctrl+Shift+C，或有选区时的 Ctrl+C（没有选区的 Ctrl+C 仍是 ^C 中断）。
      if (event.ctrlKey && key === "c" && (event.shiftKey || term.hasSelection())) {
        // 吞掉：对话流也监听 Ctrl+Shift+C（复制最后一条回答），终端里不该触发它。
        event.preventDefault();
        event.stopPropagation();
        if (term.hasSelection()) {
          void navigator.clipboard.writeText(term.getSelection());
          term.clearSelection();
        }
        return false;
      }
      // 粘贴：不拦截，让浏览器触发 paste 事件，xterm 自己处理（含括号粘贴）。
      if (event.ctrlKey && key === "v") return false;
      return true;
    });

    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        refit();
      });
    });
    observer.observe(el);

    // 主题切换（设置里改，或系统深浅色变化）：重新读 token。
    const relook = () => {
      applyLook();
      refit();
    };
    const themeObserver = new MutationObserver(relook);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", relook);

    if (takeFocusRequest(terminalKey)) term.focus();
    void connect();

    return () => {
      disposed = true;
      restartRef.current = () => undefined;
      clearTimeout(resizeTimer);
      if (frame !== 0) cancelAnimationFrame(frame);
      offData();
      offExit();
      keys.dispose();
      sizes.dispose();
      observer.disconnect();
      themeObserver.disconnect();
      scheme.removeEventListener("change", relook);
      probe.remove();
      term.dispose();
    };
  }, [terminalKey, host, platform]);

  const restart = useCallback(() => restartRef.current(), []);
  return { shell: info?.shell ?? null, cwd: info?.cwd ?? null, starting, restart };
}
