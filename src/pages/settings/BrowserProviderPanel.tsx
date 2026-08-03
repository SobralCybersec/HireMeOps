import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Field, FormRow, Input, Select } from "../../components/ui";
import { errMessage, invokeStrict, safeInvoke } from "../../lib/tauriInvoke";
import type { AiProviderSettings } from "../../types/settings";

/**
 * Sites the driven-browser provider ("Browser (free)") can target. The chosen
 * site + optional model are encoded into `defaultModel` as `"<site>/<model>"`
 * (or a bare `"<site>"` when no model is given), matching the fixed backend
 * contract for provider `kind: "browser"`. No endpoint or API key is used.
 */
export const BROWSER_SITES = [{ value: "chatgpt", label: "ChatGPT" }] as const;

// `string[]` (not the literal union) so `.includes(rawSite)` accepts any string.
const BROWSER_SITE_VALUES: string[] = BROWSER_SITES.map((s) => s.value);

/**
 * One site's live session state, exactly as `browser_provider_status` returns
 * each element. Field names mirror the Rust `BrowserProviderStatus` struct,
 * which serialises with `#[serde(rename_all = "camelCase")]`:
 *   - `initialized` — the headless session's `init` RPC has completed → "Ready"
 *   - `running`     — a helper subprocess is alive (logged-in session) → "Logged in"
 * The previous `logged_in` / `ready` names never matched this wire payload, so
 * `st.logged_in` / `st.ready` were always `undefined` and every site rendered as
 * "Logged out" even right after a successful login.
 */
export interface BrowserSiteStatus {
  site: string;
  initialized: boolean;
  running: boolean;
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
export function decodeBrowserModel(defaultModel: string): { site: string; model: string } {
  const raw = defaultModel.trim();
  if (raw === "") return { site: "", model: "" };
  const slash = raw.indexOf("/");
  const rawSite = slash === -1 ? raw : raw.slice(0, slash);
  const model = slash === -1 ? "" : raw.slice(slash + 1).trim();
  const site = BROWSER_SITE_VALUES.includes(rawSite) ? rawSite : "";
  return { site, model };
}

/** Encode a `{ site, model }` pair back into the `"<site>/<model>"` form. */
export function encodeBrowserModel(site: string, model: string): string {
  const m = model.trim();
  return m === "" ? site : `${site}/${m}`;
}

interface BrowserProviderPanelProps {
  value: AiProviderSettings;
  onUpdate: (patch: Partial<Omit<AiProviderSettings, "kind">>) => void;
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
  const [statuses, setStatuses] = useState<BrowserSiteStatus[]>(statusCache);
  const [busySite, setBusySite] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<Record<string, string[]>>(modelsCache);
  const [loadingModelsSite, setLoadingModelsSite] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    const s = await safeInvoke<BrowserSiteStatus[]>("browser_provider_status");
    if (s) {
      statusCache = s;
      setStatuses(s);
    }
  }, []);

  /**
   * List the websession models the (logged-in) site exposes and stash them in
   * `models[target]`. Uses `safeInvoke` (graceful) like the status read: a null
   * result surfaces as `error` via `errMessage` but never throws. An empty list
   * is a valid answer and is stored as-is.
   */
  const loadModels = useCallback(async (target: string) => {
    setLoadingModelsSite(target);
    setError(null);
    try {
      const list = await safeInvoke<string[]>("browser_provider_models", { site: target });
      if (list) {
        setModels((prev) => {
          const next = { ...prev, [target]: list };
          modelsCache = next;
          return next;
        });
      } else {
        setError(errMessage(`Could not load models for ${target}.`));
      }
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setLoadingModelsSite(null);
    }
  }, []);

  // Read live session state on mount. A null result (off-Tauri preview, or a
  // backend that hasn't wired the command yet) leaves every site logged-out.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const s = await safeInvoke<BrowserSiteStatus[]>("browser_provider_status");
      if (alive && s) {
        statusCache = s;
        setStatuses(s);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const statusFor = (target: string): BrowserSiteStatus | undefined =>
    statuses.find((s) => s.site === target);

  /** Drive the one-time interactive login for a site, then re-read status. */
  async function handleLogin(target: string) {
    setBusySite(target);
    setError(null);
    try {
      // The login command blocks in the bridge until the visible window reaches
      // a logged-in state, then closes it. If it hands back the models it
      // scanned off that live page, use them as an optimistic first paint.
      const list = await invokeStrict<string[]>("browser_provider_login", { site: target });
      if (Array.isArray(list) && list.length > 0) {
        setModels((prev) => {
          const next = { ...prev, [target]: list };
          modelsCache = next;
          return next;
        });
      }
      await refreshStatus();
      // Then list models against the now-live logged-in session (RustProxyHub
      // parity). The backend reuses that logged-in session instead of spinning
      // up a fresh headless one — the headless-flip that used to tear the login
      // window down and log the site back out — so a post-login models read is
      // now safe. This also covers login commands that don't return a list
      // inline; loadModels is graceful (a null result only surfaces an error).
      await loadModels(target);
      // Logging in to a site is an explicit choice to use it, so persist it as
      // the provider's target. Without this the provider stays "Not configured"
      // (empty `defaultModel`) unless the user also picks the Site in the
      // dropdown, so the analysis/draft run resolves Provider::Disabled and
      // fails with "no AI provider configured". Only rewrite when the encoded
      // site differs, preserving any model already set for the same site.
      if (site !== target) {
        onUpdate({ defaultModel: encodeBrowserModel(target, "") });
      }
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusySite(null);
    }
  }

  const siteLabel = BROWSER_SITES.find((s) => s.value === site)?.label ?? "the selected site";
  const monoField = { fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" } as const;

  return (
    <>
      <FormRow>
        <Field label="Site" htmlFor="browser-site">
          <Select
            id="browser-site"
            value={site}
            placeholder="Select a site"
            options={BROWSER_SITES.map((s) => ({ value: s.value, label: s.label }))}
            style={monoField}
            onChange={(e) => onUpdate({ defaultModel: encodeBrowserModel(e.target.value, model) })}
          />
        </Field>

        <Field label="Model (optional)" htmlFor="browser-model">
          <Input
            id="browser-model"
            type="text"
            value={model}
            placeholder="default"
            disabled={site === ""}
            style={monoField}
            onChange={(e) => onUpdate({ defaultModel: encodeBrowserModel(site, e.target.value) })}
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

      {/* One row per site: live ready/logged-in indicator + one-time Log in. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-2)",
          marginTop: "var(--sp-2)",
        }}
      >
        {BROWSER_SITES.map((s) => {
          const st = statusFor(s.value);
          const ready = st?.initialized ?? false;
          const loggedIn = st?.running ?? false;
          const siteModels = models[s.value] ?? [];
          const loadingModels = loadingModelsSite === s.value;
          return (
            <div
              key={s.value}
              style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                <span style={{ minWidth: "5rem", fontSize: "var(--text-xs)" }}>{s.label}</span>
                <Badge variant={ready ? "success" : loggedIn ? "running" : "neutral"}>
                  {ready ? "Ready" : loggedIn ? "Logged in" : "Logged out"}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busySite !== null}
                  onClick={() => void handleLogin(s.value)}
                >
                  {busySite === s.value ? "Opening…" : loggedIn ? "Log in again" : "Log in"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={loadingModels}
                  onClick={() => void loadModels(s.value)}
                >
                  {loadingModels ? "Loading…" : "Load models"}
                </Button>
              </div>
              {loadingModels && (
                <span
                  style={{
                    marginLeft: "5rem",
                    fontSize: "var(--text-xs)",
                    color: "var(--color-text-muted)",
                  }}
                >
                  Loading models…
                </span>
              )}
              {siteModels.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "var(--sp-1)",
                    marginLeft: "5rem",
                  }}
                >
                  {siteModels.map((m) => (
                    <Badge key={m} variant="neutral" style={monoField}>
                      {m}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
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
