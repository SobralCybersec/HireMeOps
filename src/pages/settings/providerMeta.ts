import { BrowserIcon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import type { AiProviderSettings } from "../../types/settings";

export type ProviderKind = AiProviderSettings["kind"];

/**
 * HugeIcon per provider kind. All cloud/API provider kinds were removed; the
 * only remaining kind is the locally-driven browser session.
 *
 *   browser → BrowserIcon (verified export - drives a real browser)
 */
export const PROVIDER_ICONS: Record<ProviderKind, IconSvgElement> = {
  browser: BrowserIcon,
};

/**
 * A provider is "configured" once it is usable.
 *
 * The browser provider has no endpoint or API key — a locally-driven session
 * is "configured" as soon as a target site is chosen (encoded in
 * `defaultModel` as `"<site>/<model>"`). Login readiness is surfaced
 * separately.
 */
export function isProviderConfigured(p: AiProviderSettings): boolean {
  return p.defaultModel.trim() !== "";
}
