import { useState } from "react";
import { Button, EmptyState, Field, Input } from "../../components/ui";
import { useSettingsStore } from "../../stores/useSettingsStore";

export interface BrowserExtensionsPanelProps {
  /** Current extension paths. Falls back to the settings store when omitted. */
  value?: string[];
  /** Called with the full next array. Falls back to `updateSettings` when omitted. */
  onChange?: (next: string[]) => void;
}

/**
 * Manage the list of unpacked Chrome extension paths that get side-loaded into
 * the driven browser. Parent may own the array via `value`/`onChange`; when
 * both are omitted the component reads/writes `browserExtensions` on the
 * settings store directly.
 */
export function BrowserExtensionsPanel({ value, onChange }: BrowserExtensionsPanelProps) {
  const storeSettings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const paths = value ?? storeSettings?.browserExtensions ?? [];
  const commit =
    onChange ?? ((next: string[]) => void updateSettings({ browserExtensions: next }));

  const [draft, setDraft] = useState("");

  /** Append a trimmed path, ignoring blanks and duplicates. */
  function handleAdd() {
    const trimmed = draft.trim();
    if (!trimmed || paths.includes(trimmed)) {
      setDraft("");
      return;
    }
    commit([...paths, trimmed]);
    setDraft("");
  }

  /** Remove the path at `idx`. */
  function handleRemove(idx: number) {
    commit(paths.filter((_, i) => i !== idx));
  }

  return (
    <div>
      <p
        style={{
          margin: 0,
          marginBottom: "var(--sp-4)",
          fontSize: "var(--text-xs)",
          color: "var(--color-text-muted)",
          lineHeight: 1.5,
        }}
      >
        Add filesystem paths to unpacked Chrome extensions. They are side-loaded into the driven
        browser on the next session via <code className="code">--load-extension</code>.
      </p>

      <Field label="Add extension path" htmlFor="ext-path">
        <div style={{ display: "flex", gap: "var(--sp-2)" }}>
          <Input
            id="ext-path"
            type="text"
            value={draft}
            placeholder="/path/to/unpacked/extension"
            style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
          />
          <Button variant="ghost" size="sm" onClick={handleAdd}>
            Add
          </Button>
        </div>
      </Field>

      <div style={{ marginTop: "var(--sp-3)" }}>
        {paths.length === 0 ? (
          <EmptyState
            label="Browser extensions"
            title="No extensions configured"
            body="Extensions you add are loaded into the automation browser at launch."
          />
        ) : (
          <ul
            aria-label="Configured browser extensions"
            style={{ listStyle: "none", margin: 0, padding: 0 }}
          >
            {paths.map((path, idx) => (
              <li
                key={path}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-2)",
                  padding: "var(--sp-2) var(--sp-3)",
                  marginBottom: "var(--sp-2)",
                  background: "var(--color-surface-2)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)",
                }}
              >
                <code
                  className="code"
                  style={{
                    flex: 1,
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-xs)",
                    wordBreak: "break-all",
                  }}
                >
                  {path}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${path}`}
                  onClick={() => handleRemove(idx)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
