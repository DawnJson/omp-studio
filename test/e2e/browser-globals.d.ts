// page.evaluate 里的回调在渲染进程运行：给 e2e 的类型检查补上 preload 暴露的 globalThis.studio（不引入 DOM 类型）。
declare var studio: import("../../src/shared/ipc.ts").StudioApi;
declare var Notification: { requestPermission(): Promise<"default" | "denied" | "granted"> };
declare var DataTransfer: new () => { items: { add(file: unknown): void } };
declare var DragEvent: new (type: string, init?: { dataTransfer?: unknown; bubbles?: boolean }) => unknown;
declare function dispatchEvent(event: unknown): boolean;
declare function fetch(url: string): Promise<{ status: number }>;
declare function getComputedStyle(element: unknown): { getPropertyValue(name: string): string; transform: string };
declare var document: {
  getElementById(id: string): { remove(): void } | null;
  createElement(tag: string): {
    id: string;
    innerHTML: string;
    getAnimations(options: { subtree: boolean }): { animationName?: string; playState: string }[];
    remove(): void;
  };
  body: { append(node: unknown): void };
};
