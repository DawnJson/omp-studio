// Electron 主进程脚本：逐个加载 html/*.html，capturePage 存 PNG；再拼对比图。
// 由 render.mjs 启动，参数：<jobs.json 路径>
const { app, BrowserWindow } = require("electron");
const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { dirname } = require("node:path");

app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.disableHardwareAcceleration();
// 每张图用完即销毁窗口，不能让"最后一个窗口关闭"触发退出
app.on("window-all-closed", () => {});

async function shot(job) {
  const win = new BrowserWindow({
    show: false,
    useContentSize: true,
    width: job.width,
    height: job.height,
    frame: false,
    webPreferences: { offscreen: false, backgroundThrottling: false },
  });
  win.setContentSize(job.width, job.height);
  await win.loadFile(job.html);
  // 等字体和图片就绪
  await win.webContents.executeJavaScript(
    "Promise.all([document.fonts.ready, ...Array.from(document.images).map(i => i.decode().catch(()=>{}))])",
  );
  await new Promise((r) => setTimeout(r, 120));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: job.width, height: job.height });
  mkdirSync(dirname(job.png), { recursive: true });
  writeFileSync(job.png, img.toPNG());
  win.destroy();
}

app
  .whenReady()
  .then(async () => {
    const jobs = JSON.parse(readFileSync(process.argv[process.argv.length - 1], "utf8"));
    for (const j of jobs) await shot(j);
    app.quit();
  })
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
