import { Badge, Button } from "../../components/ui";

const MONO_FIELD = { fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" } as const;

export interface BrowserSiteRowProps {
  site: { value: string; label: string };
  loggedIn: boolean;
  models: string[];
  loadingModels: boolean;
  busy: boolean;
  onLogin: (site: string) => void;
  onLogout: (site: string) => void;
  onLoadModels: (site: string) => void;
}

function BrowserSiteActions(props: Omit<BrowserSiteRowProps, "models">) {
  const { site, loggedIn, loadingModels, busy, onLogin, onLogout, onLoadModels } = props;
  return (
    <>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => onLogin(site.value)}>
        {busy ? "Opening…" : loggedIn ? "Log in again" : "Log in"}
      </Button>
      {loggedIn && (
        <Button variant="danger" size="sm" disabled={busy} onClick={() => onLogout(site.value)}>
          {busy ? "Logging out…" : "Log out"}
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        disabled={loadingModels || busy}
        onClick={() => onLoadModels(site.value)}
      >
        {loadingModels ? "Loading models…" : "Load models"}
      </Button>
    </>
  );
}

function BrowserModelBadges(props: Pick<BrowserSiteRowProps, "models" | "loadingModels">) {
  const { models, loadingModels } = props;
  if (loadingModels) {
    return (
      <span
        style={{ marginLeft: "5rem", fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}
      >
        Loading models…
      </span>
    );
  }
  if (models.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1)", marginLeft: "5rem" }}>
      {models.map((model) => (
        <Badge key={model} variant="neutral" style={MONO_FIELD}>
          {model}
        </Badge>
      ))}
    </div>
  );
}

export function BrowserSiteRow(props: BrowserSiteRowProps) {
  const { site, loggedIn, models, loadingModels, busy, onLogin, onLogout, onLoadModels } = props;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
        <span style={{ minWidth: "5rem", fontSize: "var(--text-xs)" }}>{site.label}</span>
        <Badge variant={loggedIn ? "success" : "neutral"}>
          {loggedIn ? "Logged in" : "Logged out"}
        </Badge>
        <BrowserSiteActions
          {...{ site, loggedIn, loadingModels, busy, onLogin, onLogout, onLoadModels }}
        />
      </div>
      <BrowserModelBadges {...{ models, loadingModels }} />
    </div>
  );
}
