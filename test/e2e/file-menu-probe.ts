// 只替换原生弹出和 Explorer 的动作，保留真实 IPC、菜单回调和剪贴板；避免测试抢走桌面焦点。
import type { ElectronApplication } from "@playwright/test";

interface FileMenuProbe {
  action: string;
  labels: string[][];
  revealed: string[];
  opened: string[];
}

export async function installFileMenuProbe(app: ElectronApplication) {
  await app.evaluate(({ Menu, shell }) => {
    const probe: FileMenuProbe = { action: "copyPath", labels: [], revealed: [], opened: [] };
    (globalThis as unknown as { fileMenuProbe: FileMenuProbe }).fileMenuProbe = probe;
    const build = Menu.buildFromTemplate;
    Menu.buildFromTemplate = (template) => {
      const menu = build(template);
      menu.popup = (options) => {
        probe.labels.push(menu.items.map((item) => item.label));
        const item = menu.getMenuItemById(probe.action);
        if (item) item.click(item, options?.window, {});
        options?.callback?.();
      };
      return menu;
    };
    shell.showItemInFolder = (file) => {
      probe.revealed.push(file);
    };
    shell.openPath = async (file) => {
      probe.opened.push(file);
      return "";
    };
  });
  return {
    labels: () => app.evaluate(() => (globalThis as unknown as { fileMenuProbe: FileMenuProbe }).fileMenuProbe.labels),
    revealed: () =>
      app.evaluate(() => (globalThis as unknown as { fileMenuProbe: FileMenuProbe }).fileMenuProbe.revealed),
    opened: () => app.evaluate(() => (globalThis as unknown as { fileMenuProbe: FileMenuProbe }).fileMenuProbe.opened),
    nextAction: (action: "copyPath" | "reveal") =>
      app.evaluate((_electron, value) => {
        (globalThis as unknown as { fileMenuProbe: FileMenuProbe }).fileMenuProbe.action = value;
      }, action),
  };
}
