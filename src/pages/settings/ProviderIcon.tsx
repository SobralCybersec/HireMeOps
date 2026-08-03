import { Icon } from "../../components/ui";
import { PROVIDER_ICONS, type ProviderKind } from "./providerMeta";

interface ProviderIconProps {
  kind: ProviderKind;
  size?: number;
  color?: string;
  className?: string;
}

/**
 * Renders the brand icon for an AI provider kind (browser-only) via the central
 * Icon wrapper over @hugeicons/core-free-icons.
 */
export function ProviderIcon({ kind, size = 18, color, className }: ProviderIconProps) {
  return <Icon icon={PROVIDER_ICONS[kind]} size={size} color={color} className={className} />;
}
