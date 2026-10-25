// omp-studio 自身更新状态的一句话说明：设置 → 关于和关于对话框共用。
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { UpdateState } from "../../../../shared/ipc.ts";

export function updateStatusText(state: UpdateState, t: TFunction): string {
  switch (state.phase) {
    case "disabled":
      return state.disabledReason === "not-packaged"
        ? t("settings.about.disabled.notPackaged")
        : state.disabledReason === "manual-only"
          ? t("settings.about.disabled.manualOnly")
          : t("settings.about.disabled.noFeed");
    case "idle":
      return "";
    case "checking":
      return t("settings.about.checking");
    case "up-to-date":
      return t("settings.about.upToDate");
    case "downloading":
      return t("settings.about.downloading", { version: state.latestVersion ?? "?", percent: state.percent });
    case "downloaded":
      return t("settings.about.downloaded", { version: state.latestVersion ?? "?" });
    case "error":
      return t("settings.about.failed");
  }
}
