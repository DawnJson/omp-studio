// 设置 → 提供商与账号：提供商列表（登录 / API key）+ 自定义提供商（models.yml）。
// omp 列出 80 多个提供商：没在搜索时只先列已配置的，其余点"显示其余 N 个"再展开；一个都没配置时全部列出（第一次用要从这里登录）。
import { describeError } from "../../ui/errors.ts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiKeyEnvName } from "../../../../shared/provider-keys.ts";
import { loginKind } from "../../../../shared/provider-login.ts";
import { splitProviders } from "../../../../shared/ui/provider-list.ts";
import { useT } from "../../i18n/use-t.ts";
import { loadAccounts, useAccountLoad } from "./accounts-store.ts";
import { Button, Card } from "./controls.tsx";
import { ProviderRow } from "./ProviderRow.tsx";
import { CustomProviders } from "./CustomProviders.tsx";

export function ProvidersSection() {
  const t = useT();
  const load = useAccountLoad();
  const data = load.kind === "ready" ? load.data : null;
  const error = load.kind === "error" ? load.error : null;
  const [loginBusy, setLoginBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const groups = useMemo(
    () => (data ? splitProviders(data.providers, data.keyProviders, query) : { configured: [], others: [] }),
    [data, query],
  );
  const collapsed = query.trim() === "" && !showAll && groups.configured.length > 0 && groups.others.length > 0;
  const visible = collapsed ? groups.configured : [...groups.configured, ...groups.others];

  // 有缓存就直接显示，进入时后台刷新一次。
  const enter = useCallback(() => void loadAccounts(), []);
  useEffect(enter, [enter]);
  // 登录/退出/改 key 之后必须重读，不能并进改动之前发起的旧读取。
  const reload = useCallback(() => void loadAccounts(true), []);

  return (
    <>
      <h3 className="settings-group-title">{t("login.providers")}</h3>
      <Card testId="providers">
        {error !== null && (
          <div className="st-block st-error-text" role="alert">
            {t("login.loadFailed", { message: describeError(t, error) })}
          </div>
        )}
        {load.kind === "ready" && load.refreshError !== null && (
          <div className="st-block st-muted" role="status" data-testid="providers-refresh-failed">
            {t("login.refreshFailed", { message: describeError(t, load.refreshError) })}
          </div>
        )}
        {error === null && data === null && <div className="st-block st-muted">{t("settings.modelsLoading")}</div>}
        {data?.providers.length === 0 && <div className="st-block st-muted">{t("login.empty")}</div>}
        {data !== null && data.providers.length > 0 && (
          <div className="st-block">
            <input
              type="search"
              className="st-input"
              value={query}
              placeholder={t("login.search")}
              aria-label={t("login.search")}
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
              data-testid="provider-search"
            />
          </div>
        )}
        {data !== null && data.providers.length > 0 && visible.length === 0 && (
          <div className="st-block st-muted" data-testid="provider-no-match">
            {t("login.noMatch")}
          </div>
        )}
        {data !== null &&
          visible.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              accounts={data.accounts[provider.id] ?? []}
              hasStoredKey={data.keyProviders.includes(provider.id)}
              canSetKey={apiKeyEnvName(provider.id) !== null}
              loginKind={loginKind(provider.id)}
              blocked={loginBusy}
              onLoginActive={setLoginBusy}
              onChanged={reload}
            />
          ))}
        {collapsed && (
          <div className="st-block">
            <Button variant="text" onClick={() => setShowAll(true)} testId="providers-more">
              {t("login.showOthers", { count: groups.others.length })}
            </Button>
          </div>
        )}
      </Card>

      <CustomProviders />
    </>
  );
}
