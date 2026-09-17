import { readCgroupMemoryLimits } from "../cloud-memory.mjs";

export function createCgroupMemoryGuard({
  ratio = 0.95,
  intervalMs = 500,
  readMemory = readCgroupMemoryLimits,
  onLimit = async () => {},
  hardRatio = 0.98,
  sustainedSamples = 10,
  hardSamples = 2,
} = {}) {
  let tripped = false;
  let softPressureSamples = 0;
  let hardPressureSamples = 0;
  const check = async () => {
    if (tripped) return false;
    const memory = readMemory();
    const { current, max } = memory;
    const workingSet = memory.workingSet ?? current;
    if (current == null || max == null || max <= 0) return false;
    const softPressure = workingSet >= max * ratio;
    const hardPressure = workingSet >= max * hardRatio;
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
      inactiveFile: memory.inactiveFile ?? null,
      activeFile: memory.activeFile ?? null,
      slabReclaimable: memory.slabReclaimable ?? null,
      slabUnreclaimable: memory.slabUnreclaimable ?? null,
      stat: memory.stat ?? {},
      events: memory.events ?? {},
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
