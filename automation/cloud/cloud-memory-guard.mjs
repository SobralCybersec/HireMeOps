import { readCgroupMemoryLimits } from "../cloud-memory.mjs";

export function createCgroupMemoryGuard({
  ratio = 0.9,
  intervalMs = 500,
  readMemory = readCgroupMemoryLimits,
  onLimit = async () => {},
} = {}) {
  let tripped = false;
  const check = async () => {
    if (tripped) return false;
    const { current, max } = readMemory();
    if (current == null || max == null || max <= 0 || current < max * ratio) return false;
    tripped = true;
    await onLimit({ current, max });
    return true;
  };
  const timer = setInterval(() => check().catch(() => {}), intervalMs);
  timer.unref?.();
  return {
    check,
    stop: () => clearInterval(timer),
  };
}
