import { readFileSync, readdirSync } from "node:fs";

const BYTES_PER_MB = 1_048_576;
let previousCpuStat = null;
let previousMemoryEvents = null;
let previousMemoryEventsAt = null;

function cgroupFile(name) {
  const path = processCgroupPath();
  const bases = [];
  if (path && path !== "/") {
    bases.push(`/sys/fs/cgroup${path}`, `/sys/fs/cgroup/memory${path}`);
  }
  bases.push("/sys/fs/cgroup");
  const base = bases.find((candidate) => readable(`${candidate}/${name}`));
  return base ? `${base}/${name}` : null;
}

function readable(file) {
  try {
    readFileSync(file, "utf8");
    return true;
  } catch {
    return false;
  }
}

function readValue(file) {
  try {
    const value = readFileSync(file, "utf8").trim();
    return value === "max" ? null : Number(value);
  } catch {
    return null;
  }
}

function readKeyValues(file) {
  try {
    return parseKeyValues(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export function parseKeyValues(raw) {
  return Object.fromEntries(
    String(raw)
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [key, value] = line.trim().split(/\s+/, 2);
        return [key, Number(value)];
      })
      .filter(([, value]) => Number.isFinite(value)),
  );
}

export function parseCpuMax(raw) {
  const [quota, period] = String(raw).trim().split(/\s+/, 2);
  const periodUsec = Number(period);
  const quotaUsec = quota === "max" ? null : Number(quota);
  return {
    quotaUsec: Number.isFinite(quotaUsec) ? quotaUsec : null,
    periodUsec: Number.isFinite(periodUsec) ? periodUsec : null,
    quotaCpus:
      Number.isFinite(quotaUsec) && Number.isFinite(periodUsec) && periodUsec > 0
        ? +(quotaUsec / periodUsec).toFixed(3)
        : null,
  };
}

function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function processCgroupPath() {
  try {
    for (const line of readFileSync("/proc/self/cgroup", "utf8").split("\n")) {
      const [hierarchy, controllers, path] = line.split(":");
      if (hierarchy === "0" || controllers?.split(",").includes("memory")) return path?.trim();
    }
  } catch {}
  return null;
}

function cgroupValue(...names) {
  for (const name of names) {
    const file = cgroupFile(name);
    if (!file) continue;
    const value = readValue(file);
    if (value != null) return value;
  }
  return null;
}

export function readCgroupMemoryLimits() {
  const stat = readKeyValues(cgroupFile("memory.stat"));
  const current = cgroupValue("memory.current", "memory/memory.usage_in_bytes");
  const inactiveFile = stat.inactive_file;
  return {
    current,
    max: cgroupValue("memory.max", "memory/memory.limit_in_bytes"),
    workingSet:
      current == null || inactiveFile == null ? current : Math.max(0, current - inactiveFile),
    inactiveFile: inactiveFile ?? null,
    activeFile: stat.active_file ?? null,
    slabReclaimable: stat.slab_reclaimable ?? null,
    slabUnreclaimable: stat.slab_unreclaimable ?? null,
    events: cgroupMemoryEvents(),
    stat,
  };
}

export function readCgroupCpu() {
  const statFile = cgroupFile("cpu.stat");
  const maxFile = cgroupFile("cpu.max");
  return {
    stat: statFile ? parseKeyValues(readText(statFile)) : {},
    ...(maxFile
      ? parseCpuMax(readText(maxFile))
      : { quotaUsec: null, periodUsec: null, quotaCpus: null }),
  };
}

export function deltaCpuStats(current = {}, previous = null) {
  const delta = (key) => {
    if (!previous) return null;
    return Math.max(0, (current[key] ?? 0) - (previous[key] ?? 0));
  };
  return {
    usageUsecDelta: delta("usage_usec"),
    userUsecDelta: delta("user_usec"),
    systemUsecDelta: delta("system_usec"),
    nrPeriodsDelta: delta("nr_periods"),
    nrThrottledDelta: delta("nr_throttled"),
    throttledUsecDelta: delta("throttled_usec"),
  };
}

function cpuSnapshot() {
  const current = readCgroupCpu();
  const previous = previousCpuStat;
  previousCpuStat = current.stat;
  const deltas = deltaCpuStats(current.stat, previous);
  return {
    quotaCpus: current.quotaCpus,
    usageUsec: current.stat.usage_usec ?? null,
    userUsec: current.stat.user_usec ?? null,
    systemUsec: current.stat.system_usec ?? null,
    nrPeriods: current.stat.nr_periods ?? null,
    nrThrottled: current.stat.nr_throttled ?? null,
    throttledUsec: current.stat.throttled_usec ?? null,
    ...deltas,
  };
}

function cgroupMemory() {
  const limits = readCgroupMemoryLimits();
  return {
    ...limits,
    current: limits.current,
    peak: cgroupValue("memory.peak", "memory/memory.max_usage_in_bytes"),
    max: limits.max,
  };
}

function cgroupMemoryStat(raw) {
  const kernel =
    raw.kernel ??
    ["kernel_stack", "pagetables", "slab", "sock"].reduce(
      (total, key) => total + (raw[key] ?? 0),
      0,
    );
  return {
    anonMb: bytesToMb(raw.anon),
    fileMb: bytesToMb(raw.file),
    shmemMb: bytesToMb(raw.shmem),
    inactiveFileMb: bytesToMb(raw.inactive_file),
    activeFileMb: bytesToMb(raw.active_file),
    kernelMb: bytesToMb(kernel),
    kernelStackMb: bytesToMb(raw.kernel_stack),
    pagetablesMb: bytesToMb(raw.pagetables),
    slabMb: bytesToMb(raw.slab),
    slabReclaimableMb: bytesToMb(raw.slab_reclaimable),
    slabUnreclaimableMb: bytesToMb(raw.slab_unreclaimable),
    sockMb: bytesToMb(raw.sock),
  };
}

function bytesToMb(value) {
  return value == null ? null : +(value / BYTES_PER_MB).toFixed(1);
}

function memoryEventDeltas(events) {
  const now = Date.now();
  const previous = previousMemoryEvents;
  const elapsedMs =
    previousMemoryEventsAt == null ? null : Math.max(1, now - previousMemoryEventsAt);
  previousMemoryEvents = events;
  previousMemoryEventsAt = now;
  const delta = previous ? Math.max(0, events.max - previous.max) : null;
  return {
    memoryMaxEventsDelta: delta,
    memoryMaxEventsPerSecond:
      delta == null || elapsedMs == null ? null : +((delta * 1000) / elapsedMs).toFixed(1),
  };
}

function cgroupMemoryEvents() {
  const raw = readKeyValues(cgroupFile("memory.events"));
  return {
    low: eventCount(raw, "low"),
    high: eventCount(raw, "high"),
    max: eventCount(raw, "max"),
    oom: eventCount(raw, "oom"),
    oomKill: eventCount(raw, "oom_kill"),
  };
}

function eventCount(events, key) {
  return events[key] ?? 0;
}

function pssKb(pid) {
  try {
    const match = /^Pss:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, "utf8"));
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

function processTree(root) {
  const children = new Map();
  try {
    for (const name of readdirSync("/proc")) {
      if (!/^\d+$/.test(name)) continue;
      const match = /^PPid:\s+(\d+)/m.exec(readFileSync(`/proc/${name}/status`, "utf8"));
      if (!match) continue;
      const parent = Number(match[1]);
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(Number(name));
    }
  } catch {
    return [];
  }
  const found = [];
  const pending = [root];
  while (pending.length) {
    for (const pid of children.get(pending.pop()) ?? []) {
      found.push(pid);
      pending.push(pid);
    }
  }
  return found;
}

function processName(pid) {
  try {
    return readFileSync(`/proc/${pid}/comm`, "utf8").trim();
  } catch {
    return "";
  }
}

function processCommandLine(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim();
  } catch {
    return "";
  }
}

function isZombie(pid) {
  try {
    return /^State:\s+Z\b/m.test(readFileSync(`/proc/${pid}/status`, "utf8"));
  } catch {
    return true;
  }
}

function chromiumType(pid, name, command) {
  if (!/chrom|headless_shell/i.test(`${name} ${command}`)) return null;
  const type = /(?:^|\s)--type=([^\s]+)/.exec(command)?.[1];
  if (!type) return "browser";
  if (type === "utility" && /NetworkService/i.test(command)) return "network-service";
  return type;
}

function collectProcessMemory(pids) {
  let nodePss = 0;
  let chromiumPss = 0;
  let otherPss = 0;
  let chromiumProcesses = 0;
  const chromiumByType = {};
  for (const pid of pids) {
    if (isZombie(pid)) continue;
    const name = processName(pid);
    const command = processCommandLine(pid);
    const pss = pssKb(pid);
    if (pid === process.pid || /node|cloud-runner/i.test(`${name} ${command}`)) {
      nodePss += pss;
      continue;
    }
    const type = chromiumType(pid, name, command);
    if (type) {
      chromiumPss += pss;
      chromiumProcesses += 1;
      chromiumByType[type] = (chromiumByType[type] ?? 0) + pss;
    } else {
      otherPss += pss;
    }
  }
  return { nodePss, chromiumPss, otherPss, chromiumProcesses, chromiumByType };
}

export function chromiumProcessCount() {
  return processTree(process.pid).filter((pid) => {
    if (isZombie(pid)) return false;
    return chromiumType(pid, processName(pid), processCommandLine(pid)) != null;
  }).length;
}

function mb(value) {
  return +(value / 1024).toFixed(1);
}

export function memorySnapshot(stage) {
  const pids = [process.pid, ...processTree(process.pid)];
  const { nodePss, chromiumPss, otherPss, chromiumProcesses, chromiumByType } =
    collectProcessMemory(pids);
  const cgroup = cgroupMemory();
  const cpu = cpuSnapshot();
  const stat = cgroupMemoryStat(cgroup.stat);
  const events = cgroup.events ?? cgroupMemoryEvents();
  const memoryEventDelta = memoryEventDeltas(events);
  const nodeUsage = process.memoryUsage();
  const toMb = (value) => (value == null ? null : +(value / BYTES_PER_MB).toFixed(1));
  return {
    stage,
    at: new Date().toISOString(),
    nodeRssMb: +(process.memoryUsage().rss / BYTES_PER_MB).toFixed(1),
    nodeMemoryMb: Object.fromEntries(
      Object.entries(nodeUsage).map(([key, value]) => [key, +(value / BYTES_PER_MB).toFixed(1)]),
    ),
    nodePssMb: mb(nodePss),
    chromiumPssMb: mb(chromiumPss),
    chromiumPssByTypeMb: Object.fromEntries(
      Object.entries(chromiumByType).map(([type, value]) => [type, mb(value)]),
    ),
    otherProcessPssMb: mb(otherPss),
    cgroupCurrentMb: cgroup.current == null ? null : +(cgroup.current / BYTES_PER_MB).toFixed(1),
    cgroupWorkingSetMb: toMb(cgroup.workingSet),
    inactiveFileMb: toMb(cgroup.inactiveFile),
    activeFileMb: toMb(cgroup.activeFile),
    slabReclaimableMb: toMb(cgroup.slabReclaimable),
    slabUnreclaimableMb: toMb(cgroup.slabUnreclaimable),
    cgroupPeakMb: cgroup.peak == null ? null : +(cgroup.peak / BYTES_PER_MB).toFixed(1),
    cgroupMaxMb: cgroup.max == null ? null : +(cgroup.max / BYTES_PER_MB).toFixed(1),
    ...memoryEventDelta,
    cgroup: {
      currentMb: cgroup.current == null ? null : +(cgroup.current / BYTES_PER_MB).toFixed(1),
      workingSetMb: toMb(cgroup.workingSet),
      peakMb: cgroup.peak == null ? null : +(cgroup.peak / BYTES_PER_MB).toFixed(1),
      maxMb: cgroup.max == null ? null : +(cgroup.max / BYTES_PER_MB).toFixed(1),
      stat,
      events,
    },
    cpu,
    chromiumProcesses,
  };
}
