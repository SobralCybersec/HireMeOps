export type ThemeMode = "dark" | "light" | "system";
export type ReducedEffectsMode = "on" | "off" | "auto";

export interface AiProviderSettings {
  kind: "openai" | "anthropic" | "ollama" | "custom";
  label: string;
  endpointUrl: string;
  apiKeyStored: boolean;
  defaultModel: string;
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
}
