// page.evaluate 里的回调在渲染进程运行：给 e2e 的类型检查补上 preload 暴露的 globalThis.studio（不引入 DOM 类型）。
declare var studio: import("../../src/shared/ipc.ts").StudioApi;
