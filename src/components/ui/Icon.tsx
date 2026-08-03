import { HugeiconsIcon } from "@hugeicons/react";
import type { HugeiconsIconProps } from "@hugeicons/react";

/**
 * Centralized hugeicons wrapper. Defaults for size/color/strokeWidth live here
 * so every call site stays a single named-import + `<Icon icon={...} />`.
 * Pass any HugeiconsIcon prop through `...rest` to override a default.
 */
export function Icon({
  size = 16,
  color = "currentColor",
  strokeWidth = 1.5,
  ...rest
}: HugeiconsIconProps) {
  return <HugeiconsIcon size={size} color={color} strokeWidth={strokeWidth} {...rest} />;
}
