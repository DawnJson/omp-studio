// 配置默认值（`omp config list --json` 的快照，设置页同一份）：给"本会话没动过"的开关补值，并判断"和默认不同"的小圆点。
import { useEffect, useMemo } from "react";
import { TOGGLE_CONFIG_KEYS, toggleDefaults, type ToggleDefaults } from "../../../../shared/omp-output/toggles.ts";
import { ensureOmpConfigLoaded, useOmpConfigValue } from "../settings/config-store.ts";

export function useToggleDefaults(): ToggleDefaults {
  useEffect(ensureOmpConfigLoaded, []);
  const skillful = useOmpConfigValue(TOGGLE_CONFIG_KEYS.skillful);
  const extendedContext = useOmpConfigValue(TOGGLE_CONFIG_KEYS.extendedContext);
  const computer = useOmpConfigValue(TOGGLE_CONFIG_KEYS.computer);
  const advisor = useOmpConfigValue(TOGGLE_CONFIG_KEYS.advisor);
  const headless = useOmpConfigValue(TOGGLE_CONFIG_KEYS.browserHeadless);
  const prewalk = useOmpConfigValue(TOGGLE_CONFIG_KEYS.prewalk);
  return useMemo(() => {
    const values: Record<string, unknown> = {
      [TOGGLE_CONFIG_KEYS.skillful]: skillful,
      [TOGGLE_CONFIG_KEYS.extendedContext]: extendedContext,
      [TOGGLE_CONFIG_KEYS.computer]: computer,
      [TOGGLE_CONFIG_KEYS.advisor]: advisor,
      [TOGGLE_CONFIG_KEYS.browserHeadless]: headless,
      [TOGGLE_CONFIG_KEYS.prewalk]: prewalk,
    };
    return toggleDefaults((key) => values[key]);
  }, [skillful, extendedContext, computer, advisor, headless, prewalk]);
}
