import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { Field, FormRow, Input, Select } from "../../components/ui";
import { BrowserSiteRow } from "./BrowserProviderRows";
import {
  choosePreferredBrowserModel,
  encodeBrowserModel,
  isAutomaticBrowserModel,
} from "./browser-model-selection";
import { errMessage, invokeStrict, safeInvoke } from "../../lib/tauriInvoke";
import type { AiProviderSettings } from "../../types/settings";

/**
 * Sites the driven-browser provider ("Browser (free)") can target. The chosen
 * site + optional model are encoded into `defaultModel` as `"<site>/<model>"`
 * (or a bare `"<site>"` when no model is given), matching the fixed backend
 * contract for provider `kind: "browser"`. No endpoint or API key is used.
 */
const BROWSER_SITES = [{ value: "chatgpt", label: "ChatGPT" }] as const;

// `string[]` (not the literal union) so `.includes(rawSite)` accepts any string.
const BROWSER_SITE_VALUES: string[] = BROWSER_SITES.map((s) => s.value);

/**
 * One site's live session state, exactly as `browser_provider_status` returns
 * each element. Field names mirror the Rust `BrowserProviderStatus` struct,
 * which serialises with `#[serde(rename_all = "camelCase")]`:
 *   - `initialized` — the headless session's `init` RPC has completed
 *   - `running`     — a helper subprocess is alive
 *   - `loggedIn`    — the ChatGPT session cookie is present
 */
export interface BrowserSiteStatus {
  site: string;
  initialized: boolean;
  running: boolean;
  loggedIn: boolean;
}

/**
 * Module-scoped cache of the last resolved status / models. React-router
 * unmounts the `/settings` route element on every tab switch, so the panel
 * fully remounts with fresh local state each time. Without this cache the panel
 * resets `statuses` to `[]` on mount — flashing every site to "Logged out" and
 * re-rendering (the visible flicker) until the async `browser_provider_status`
 * re-resolves. Seeding `useState` from the cache keeps the last-known state on
 * screen across remounts; each fetch refreshes the cache so it never goes stale.
 */
let statusCache: BrowserSiteStatus[] = [];
let modelsCache: Record<string, string[]> = {};

/**
 * Decode a stored `defaultModel` into its `{ site, model }` parts. An empty or
 * unrecognised site decodes to `site: ""` so the Select shows its placeholder
 * and the provider reads as "Not configured" until the user picks a site.
 */
function decodeBrowserModel(defaultModel: string): { site: string; model: string } {
  const raw = defaultModel.trim();
  if (raw === "") return { site: "", model: "" };
  const slash = raw.indexOf("/");
  const rawSite = slash === -1 ? raw : raw.slice(0, slash);
  const model = slash === -1 ? "" : raw.slice(slash + 1).trim();
  const site = BROWSER_SITE_VALUES.includes(rawSite) ? rawSite : "";
  return { site, model };
}

interface BrowserProviderPanelProps {
  value: AiProviderSettings;
  onUpdate: (patch: Partial<Omit<AiProviderSettings, "kind">>) => void;
}

const MONO_FIELD = { fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" } as const;
interface StateSetter<T> {
  (value: T | ((previous: T) => T)): void;
}

function cacheBrowserModels(
  target: string,
  list: string[],
  setModels: StateSetter<Record<string, string[]>>,
) {
  setModels((previous) => {
    const next = { ...previous, [target]: list };
    modelsCache = next;
    return next;
  });
}

async function refreshBrowserStatus(
  setStatuses: StateSetter<BrowserSiteStatus[]>,
): Promise<BrowserSiteStatus[] | null> {
  const statuses = await safeInvoke<BrowserSiteStatus[]>("browser_provider_status");
  if (statuses) {
    statusCache = statuses;
    setStatuses(statuses);
  }
  return statuses;
}

interface BrowserModelActionContext {
  setLoadingModelsSite: (site: string | null) => void;
  setError: (error: string | null) => void;
  setModels: StateSetter<Record<string, string[]>>;
  selectionRef: MutableRefObject<{
    site: string;
    model: string;
    onUpdate: BrowserProviderPanelProps["onUpdate"];
  }>;
}

async function loadBrowserModels(
  target: string,
  context: BrowserModelActionContext,
): Promise<string[]> {
  const { setLoadingModelsSite, setError, setModels, selectionRef } = context;
  setLoadingModelsSite(target);
  setError(null);
  try {
    const list = await safeInvoke<string[]>("browser_provider_models", { site: target });
    if (!list) {
      setError(errMessage(`Could not load models for ${target}.`));
      return [];
    }
    cacheBrowserModels(target, list, setModels);
    const preferred = choosePreferredBrowserModel(list);
    const selection = selectionRef.current;
    if (
      selection.site === target &&
      isAutomaticBrowserModel(selection.model) &&
      preferred !== "" &&
      preferred !== selection.model
    ) {
      selection.onUpdate({ defaultModel: encodeBrowserModel(target, preferred) });
    }
    return list;
  } catch (error) {
    setError(errMessage(error));
    return [];
  } finally {
    setLoadingModelsSite(null);
  }
}

interface BrowserLoginContext extends BrowserModelActionContext {
  setBusySite: (site: string | null) => void;
  refreshStatus: () => Promise<BrowserSiteStatus[] | null>;
  loadModels: (site: string) => Promise<string[]>;
  site: string;
  onUpdate: BrowserProviderPanelProps["onUpdate"];
}

async function loginBrowserSite(target: string, context: BrowserLoginContext) {
  const { setBusySite, setError, setModels, refreshStatus, loadModels, site, onUpdate } = context;
  setBusySite(target);
  setError(null);
  try {
    const list = await invokeStrict<string[]>("browser_provider_login", { site: target });
    if (Array.isArray(list) && list.length > 0) cacheBrowserModels(target, list, setModels);
    await refreshStatus();
    const loadedModels = await loadModels(target);
    if (site !== target) {
      onUpdate({
        defaultModel: encodeBrowserModel(target, choosePreferredBrowserModel(loadedModels)),
      });
    }
  } catch (error) {
    setError(errMessage(error));
  } finally {
    setBusySite(null);
  }
}

async function logoutBrowserSite(
  target: string,
  context: {
    setBusySite: (site: string | null) => void;
    setError: (error: string | null) => void;
    statuses: BrowserSiteStatus[];
    setStatuses: StateSetter<BrowserSiteStatus[]>;
    setModels: StateSetter<Record<string, string[]>>;
    refreshStatus: () => Promise<BrowserSiteStatus[] | null>;
  },
) {
  const { setBusySite, setError, statuses, setStatuses, setModels, refreshStatus } = context;
  setBusySite(target);
  setError(null);
  try {
    await invokeStrict<void>("browser_provider_logout", { site: target });
    const next = statuses.map((status) =>
      status.site === target
        ? { ...status, initialized: false, running: false, loggedIn: false }
        : status,
    );
    statusCache = next;
    setStatuses(next);
    cacheBrowserModels(target, [], setModels);
    await refreshStatus();
  } catch (error) {
    setError(errMessage(error));
  } finally {
    setBusySite(null);
  }
}

function BrowserProviderFields(props: {
  site: string;
  model: string;
  onUpdate: BrowserProviderPanelProps["onUpdate"];
}) {
  const { site, model, onUpdate } = props;
  const siteLabel =
    BROWSER_SITES.find((option) => option.value === site)?.label ?? "the selected site";
  return (
    <>
      <FormRow>
        <Field label="Site" htmlFor="browser-site">
          <Select
            id="browser-site"
            value={site}
            placeholder="Select a site"
            options={BROWSER_SITES.map((option) => ({ value: option.value, label: option.label }))}
            style={MONO_FIELD}
            onChange={(event) =>
              onUpdate({ defaultModel: encodeBrowserModel(event.target.value, model) })
            }
          />
        </Field>
        <Field label="Model (optional)" htmlFor="browser-model">
          <Input
            id="browser-model"
            type="text"
            value={model}
            placeholder="default"
            disabled={site === ""}
            style={MONO_FIELD}
            onChange={(event) =>
              onUpdate({ defaultModel: encodeBrowserModel(site, event.target.value) })
            }
          />
        </Field>
      </FormRow>
      <p
        className="field__helper"
        style={{
          marginTop: "var(--sp-2)",
          fontSize: "var(--text-xs)",
          color: "var(--color-text-muted)",
        }}
      >
        Drives a real, locally-controlled browser session for {siteLabel} — no API key needed. A
        one-time login per site is required; the session is reused after that.
      </p>
    </>
  );
}

function BrowserSiteList(props: {
  statuses: BrowserSiteStatus[];
  models: Record<string, string[]>;
  busySite: string | null;
  loadingModelsSite: string | null;
  error: string | null;
  onLogin: (site: string) => void;
  onLogout: (site: string) => void;
  onLoadModels: (site: string) => void;
}) {
  const { statuses, models, busySite, loadingModelsSite, error, onLogin, onLogout, onLoadModels } =
    props;
  const statusFor = (site: string) => statuses.find((status) => status.site === site);
  return (
    <>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-2)",
          marginTop: "var(--sp-2)",
        }}
      >
        {BROWSER_SITES.map((siteOption) => {
          const siteStatus = statusFor(siteOption.value);
          return (
            <BrowserSiteRow
              key={siteOption.value}
              site={siteOption}
              loggedIn={siteStatus?.loggedIn ?? false}
              models={models[siteOption.value] ?? []}
              loadingModels={loadingModelsSite === siteOption.value}
              busy={busySite !== null}
              onLogin={onLogin}
              onLogout={onLogout}
              onLoadModels={onLoadModels}
            />
          );
        })}
      </div>
      {error !== null && (
        <div
          className="provider-test-result is-error"
          style={{
            marginTop: "var(--sp-2)",
            fontSize: "var(--text-xs)",
            color: "var(--color-danger, #ef4444)",
          }}
        >
          {error}
        </div>
      )}
    </>
  );
}

/**
 * Config controls for the local driven-browser provider. Instead of an endpoint
 * + API key it exposes a Site selector, an optional Model input, and a one-time
 * interactive "Log in" per site. It owns NO auth logic — it only drives the
 * `browser_provider_login` / `browser_provider_status` commands and reflects the
 * returned state, mirroring `ProviderOAuthPanel`'s read/act split (a missing
 * status read degrades to "logged out"; every login uses `invokeStrict`).
 */
export function BrowserProviderPanel({ value, onUpdate }: BrowserProviderPanelProps) {
  const { site, model } = decodeBrowserModel(value.defaultModel);
  const selectionRef = useRef({ site, model, onUpdate });
  selectionRef.current = { site, model, onUpdate };
  const [statuses, setStatuses] = useState<BrowserSiteStatus[]>(statusCache);
  const [busySite, setBusySite] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<Record<string, string[]>>(modelsCache);
  const [loadingModelsSite, setLoadingModelsSite] = useState<string | null>(null);

  const refreshStatus = useCallback(() => refreshBrowserStatus(setStatuses), []);
  const loadModels = useCallback(
    (target: string) =>
      loadBrowserModels(target, { setLoadingModelsSite, setError, setModels, selectionRef }),
    [],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const s = await safeInvoke<BrowserSiteStatus[]>("browser_provider_status");
      if (!alive || !s) return;
      statusCache = s;
      setStatuses(s);
      await Promise.all(
        s.filter((status) => status.loggedIn).map((status) => loadModels(status.site)),
      );
    })();
    return () => {
      alive = false;
    };
  }, [loadModels]);

  const handleLogin = (target: string) =>
    loginBrowserSite(target, {
      setBusySite,
      setError,
      setModels,
      selectionRef,
      setLoadingModelsSite,
      refreshStatus,
      loadModels,
      site,
      onUpdate,
    });
  const handleLogout = (target: string) =>
    logoutBrowserSite(target, {
      setBusySite,
      setError,
      statuses,
      setStatuses,
      setModels,
      refreshStatus,
    });

  return (
    <>
      <BrowserProviderFields site={site} model={model} onUpdate={onUpdate} />
      <BrowserSiteList
        statuses={statuses}
        models={models}
        busySite={busySite}
        loadingModelsSite={loadingModelsSite}
        error={error}
        onLogin={(target) => void handleLogin(target)}
        onLogout={(target) => void handleLogout(target)}
        onLoadModels={(target) => void loadModels(target)}
      />
    </>
  );
}
