import { readCgroupMemoryLimits } from "../cloud-memory.mjs";

export function createCgroupMemoryGuard({
  ratio = 0.9,
  intervalMs = 500,
  readMemory = readCgroupMemoryLimits,
  onLimit = async () => {},
  hardRatio = 0.998,
  sustainedSamples = 3,
  hardSamples = 2,
} = {}) {
  let tripped = false;
  let softPressureSamples = 0;
  let hardPressureSamples = 0;
  const check = async () => {
    if (tripped) return false;
    const { current, max, workingSet = current } = readMemory();
    if (current == null || max == null || max <= 0) return false;
    const softPressure = workingSet >= max * ratio;
    const hardPressure = current >= max * hardRatio;
    softPressureSamples = softPressure ? softPressureSamples + 1 : 0;
    hardPressureSamples = hardPressure ? hardPressureSamples + 1 : 0;
    const reason =
      hardPressureSamples >= hardSamples
        ? "cgroup_hard_limit"
        : softPressureSamples >= sustainedSamples
          ? "working_set_sustained"
          : null;
    if (!reason) return false;
    tripped = true;
    await onLimit({
      current,
      max,
      workingSet,
      reason,
      pressureSamples: Math.max(softPressureSamples, hardPressureSamples),
    });
    return true;
  };
  const timer = setInterval(() => check().catch(() => {}), intervalMs);
  timer.unref?.();
  return {
    check,
    stop: () => clearInterval(timer),
  };
}
