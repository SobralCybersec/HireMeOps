export type ThemeMode = "dark" | "light" | "system" | "red" | "solo-leveling";
export type ReducedEffectsMode = "on" | "off" | "auto";

export interface AiProviderSettings {
  /**
   * The only supported provider kind. A locally-driven Playwright browser
   * session — no API key or endpoint. The target site + optional model are
   * encoded in `defaultModel` as `"<site>/<model>"`
   * (site ∈ chatgpt|gemini|mistral|zai|meta); auth is a one-time interactive
   * login handled by the `browser_provider_*` commands.
   *
   * All cloud/API provider kinds were removed; the Rust backend maps any other
   * kind to an unsupported/disabled error, so the frontend only ever emits
   * `"browser"`.
   */
  kind: "browser";
  label: string;
  endpointUrl: string;
  apiKeyStored: boolean;
  defaultModel: string;
  /**
   * How this provider authenticates:
   * - `"api_key"` — API key sourced from an environment variable (default).
   * - `"oauth"` — subscription login; the bearer token is held in the OS
   *   keyring and refreshed by the backend (Claude Pro/Max, ChatGPT, Gemini).
   */
  authKind: "api_key" | "oauth";
}

export interface AppSettings {
  activeProfileId: string | null;
  appLanguage: string;
  startupBehavior: "normal" | "minimized" | "tray";
  portableMode: boolean;

  theme: ThemeMode;
  reducedEffects: ReducedEffectsMode;

  aiProviders: AiProviderSettings[];
  defaultAiProviderIndex: number;

  browserProfileRootPath: string;

  databasePath: string;
  auditLogRetentionDays: number;
  automationEvidenceRetentionDays: number;

  /**
   * Filesystem paths to unpacked Chrome extensions loaded into the driven
   * browser via `--load-extension`. Empty by default.
   */
  browserExtensions: string[];
}
