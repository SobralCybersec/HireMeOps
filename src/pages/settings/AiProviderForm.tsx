import { useState } from "react";
import { Card, Button, Badge } from "../../components/ui";
import type { AiProviderSettings } from "../../types/settings";

export interface AiProviderFormProps {
  kind: AiProviderSettings["kind"];
  value: AiProviderSettings;
  isDefault: boolean;
  onUpdate: (patch: Partial<Omit<AiProviderSettings, "kind">>) => void;
  onSetDefault: () => void;
}

const META: Record<
  AiProviderSettings["kind"],
  { label: string; endpointHint: string; modelHint: string }
> = {
  openai: {
    label: "OpenAI-compatible",
    endpointHint: "https://api.openai.com/v1",
    modelHint: "gpt-4o",
  },
  anthropic: {
    label: "Anthropic-compatible",
    endpointHint: "https://api.anthropic.com",
    modelHint: "claude-3-5-sonnet-20241022",
  },
  ollama: {
    label: "Ollama / local",
    endpointHint: "http://localhost:11434",
    modelHint: "llama3.2",
  },
  custom: {
    label: "Custom proxy",
    endpointHint: "https://proxy.example.com/v1",
    modelHint: "provider/model",
  },
};

/** Single AI-provider config card. Parent owns the aiProviders array. */
export function AiProviderForm({
  kind,
  value,
  isDefault,
  onUpdate,
  onSetDefault,
}: AiProviderFormProps) {
  const [testing, setTesting] = useState(false);
  const m = META[kind];

  function handleTest() {
    // ponytail: no test_provider backend command yet — visual stub only
    setTesting(true);
    setTimeout(() => setTesting(false), 800);
  }

  return (
    <div style={{ marginBottom: "var(--sp-3)" }}>
      <Card
        title={m.label}
        actions={isDefault ? <Badge variant="success">Default</Badge> : null}
      >
        <div className="form-grid">
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label className="field__label" htmlFor={`ep-${kind}`}>
              Endpoint URL
            </label>
            <input
              id={`ep-${kind}`}
              type="url"
              className="field__input"
              value={value.endpointUrl}
              placeholder={m.endpointHint}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-xs)",
              }}
              onChange={(e) => onUpdate({ endpointUrl: e.target.value })}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor={`mdl-${kind}`}>
              Default model
            </label>
            <input
              id={`mdl-${kind}`}
              type="text"
              className="field__input"
              value={value.defaultModel}
              placeholder={m.modelHint}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-xs)",
              }}
              onChange={(e) => onUpdate({ defaultModel: e.target.value })}
            />
          </div>

          <div className="field">
            <span className="field__label">API key</span>
            <label
              className="check-label"
              style={{ marginTop: "var(--sp-2)" }}
            >
              <input
                type="checkbox"
                checked={value.apiKeyStored}
                onChange={(e) => onUpdate({ apiKeyStored: e.target.checked })}
              />
              {value.apiKeyStored
                ? "Stored in system keychain"
                : "Not stored"}
            </label>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: "var(--sp-2)",
            marginTop: "var(--sp-3)",
          }}
        >
          <Button
            variant="ghost"
            size="sm"
            disabled={testing}
            onClick={handleTest}
          >
            {testing ? "Testing…" : "Test provider"}
          </Button>
          {!isDefault && (
            <Button variant="ghost" size="sm" onClick={onSetDefault}>
              Set as default
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
