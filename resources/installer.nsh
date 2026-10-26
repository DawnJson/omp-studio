; 向导式安装器的补充（electron-builder.yml 的 nsis.include）。页面顺序：欢迎 → 许可协议 → 安装目录 → 安装 → 完成（可勾选"运行"）。
; 自动更新时安装器以 /S 静默运行，不显示任何页面。

; electron-builder 的向导默认没有欢迎页；侧边大图（resources/installerSidebar.bmp）显示在这一页和完成页。
; 更新（--updated）时跳过，和 electron-builder 对许可协议页、目录页的处理一样：0.4.16 及以前的版本不静默运行新安装器，
; 从它们升上来的那一次只看到进度页和完成页。
!macro customWelcomePage
  !insertmacro skipPageIfUpdated
  !insertmacro MUI_PAGE_WELCOME
!macroend

; 只装给当前用户（%LOCALAPPDATA%\Programs\omp-studio），跳过"为谁安装"那一页：不要管理员权限，自动更新也不弹 UAC。
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; 卸载时删掉 studio 写进 omp 扩展目录的账号插件（src/main/client-accounts/deploy.ts），不然终端版 omp 还会一直加载这份旧代码。
; 目录和 studio 的 resolveAgentDir 一致：PI_CODING_AGENT_DIR，否则 <家目录>\<PI_CONFIG_DIR 或 .omp>\agent。
; 只在目录里有 studio 的文件清单时删（确认是 studio 写的）；更新（--updated）时旧版本的卸载也会跑，这时不删。
!macro customUnInstall
  ${ifNot} ${isUpdated}
    Push $0
    ReadEnvStr $0 PI_CODING_AGENT_DIR
    ${if} $0 == ""
      ReadEnvStr $0 PI_CONFIG_DIR
      ${if} $0 == ""
        StrCpy $0 ".omp"
      ${endif}
      StrCpy $0 "$PROFILE\$0\agent"
    ${endif}
    ${if} ${FileExists} "$0\extensions\studio-accounts\.studio-files.json"
      RMDir /r "$0\extensions\studio-accounts"
    ${endif}
    Pop $0
  ${endif}
!macroend
