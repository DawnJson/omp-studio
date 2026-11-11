// `/pet`（docs/architecture/pet.md「入口」）：studio 自己的命令，不发给 omp。
// 不带参数 = 显示宠物并打开属性卡；pet 摸一下；card 属性卡；mute / unmute 说话开关；on / off 显示开关；rename <名字> 改名。
// 草稿页也能用（宠物和任务无关）。参数不认识时提示用法。
import type { TFunction } from "../../../../shared/i18n/index.ts";
import { reportError } from "../../ui/errors.ts";
import { pushToast } from "../dialogs/toast-store.ts";
import type { StudioSlashCommand } from "../composer/studio-slash.ts";

async function runPetSlash(args: string, t: TFunction): Promise<void> {
  const [word = "", ...rest] = args.split(/\s+/).filter((part) => part !== "");
  const studio = window.studio;
  try {
    switch (word.toLowerCase()) {
      case "":
      case "card":
        return await studio.petAction("card");
      case "pet":
        return await studio.petAction("pet");
      case "mute":
        return await studio.setPetTalk(false);
      case "unmute":
        return await studio.setPetTalk(true);
      case "on":
        return await studio.setPetEnabled(true);
      case "off":
        return await studio.setPetEnabled(false);
      case "rename":
        if (rest.length > 0) return await studio.renamePet(rest.join(" "));
    }
    pushToast({ level: "info", message: t("pet.slashUsage") });
  } catch (error) {
    reportError(t, error);
  }
}

export const petSlash: StudioSlashCommand = {
  name: "pet",
  descKey: "pet.slashDesc",
  run: (_taskId, args, t) => runPetSlash(args, t),
  draft: runPetSlash,
};
