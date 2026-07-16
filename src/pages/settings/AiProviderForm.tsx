import { useState } from "react";
import { Badge, Button, Card } from "../../components/ui";
import type { AiProviderSettings } from "../../types/settings";
import { invokeStrict } from "../../lib/tauriInvoke";
import { ProviderIcon } from "./ProviderIcon";
import { isProviderConfigured } from "./providerMeta";
import { BrowserProviderPanel } from "./BrowserProviderPanel";

const META: Record<
  AiProviderSettings["kind"],
  { label: string; endpointHint: string; modelHint: string }
> = {
  browser: {
    label: "Browser (free)",
    // Browser has no endpoint/API key; the model hint documents the
    // "<site>/<model>" encoding surfaced by BrowserProviderPanel.
    endpointHint: "",
    modelHint: "chatgpt/gpt-5",
  },
};

export interface AiProviderFormProps {
  kind: AiProviderSettings["kind"];
  value: AiProviderSettings;
  isDefault: boolean;
  onUpdate: (patch: Partial<Omit<AiProviderSettings, "kind">>) => void;
  onSetDefault: () => void;
}

/** Single AI-provider config card. Parent owns the aiProviders array. */
export function AiProviderForm({
  kind,
  value,
  isDefault,
  onUpdate,
  onSetDefault,
}: AiProviderFormProps) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    errorKind?: string | null;
  } | null>(null);
  const m = META[kind];
  const configured = isProviderConfigured(value);

  /** Propagate field edits to the parent and clear any stale test result. */
  function handleUpdate(patch: Partial<Omit<AiProviderSettings, "kind">>) {
    setTestResult(null);
    onUpdate(patch);
  }

  /** Fire a real end-to-end reachability probe via the Rust backend. */
  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await invokeStrict<{
        ok: boolean;
        message: string;
        errorKind?: string | null;
      }>("test_provider", {
        kind: value.kind,
        endpointUrl: value.endpointUrl,
        defaultModel: value.defaultModel,
        authKind: value.authKind,
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, message: String(err) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div style={{ marginBottom: "var(--sp-3)" }}>
      <Card
        title={
          <span className="ai-provider__title">
            <ProviderIcon kind={kind} size={18} />
            {m.label}
          </span>
        }
        actions={
          <span className="ai-provider__meta">
            <span className={`ai-provider__status${configured ? " is-configured" : ""}`}>
              {configured ? "Configured" : "Not configured"}
            </span>
            {isDefault ? <Badge variant="success">Default</Badge> : null}
          </span>
        }
      >
        <BrowserProviderPanel value={value} onUpdate={handleUpdate} />

        <div
          style={{
            display: "flex",
            gap: "var(--sp-2)",
            marginTop: "var(--sp-3)",
          }}
        >
          <Button variant="ghost" size="sm" disabled={testing} onClick={handleTest}>
            {testing ? "Testing..." : "Test provider"}
          </Button>
          {!isDefault && (
            <Button variant="ghost" size="sm" onClick={onSetDefault}>
              Set as default
            </Button>
          )}
        </div>

        {testResult !== null && (
          <div
            className={`provider-test-result${testResult.ok ? " is-ok" : " is-error"}`}
            style={{
              marginTop: "var(--sp-2)",
              fontSize: "var(--text-xs)",
              color: testResult.ok
                ? "var(--color-success, #22c55e)"
                : "var(--color-danger, #ef4444)",
            }}
          >
            {testResult.message}
          </div>
        )}
      </Card>
    </div>
  );
}
