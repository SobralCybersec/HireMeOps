import { Input } from "../../components/ui";
import type { AppSettings } from "../../types/settings";

export function BrowserProfileInput({ settings }: { settings: AppSettings | null }) {
  return (
    <Input
      id="browser-root"
      type="text"
      value={settings?.browserProfileRootPath ?? ""}
      readOnly
      aria-readonly="true"
      placeholder="Set by backend on first launch"
      style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}
      onChange={() => {}}
    />
  );
}
