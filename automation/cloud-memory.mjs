import { readFileSync, readdirSync } from "node:fs";

const BYTES_PER_MB = 1_048_576;

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
    return Object.fromEntries(
      readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [key, value] = line.trim().split(/\s+/, 2);
          return [key, Number(value)];
        })
        .filter(([, value]) => Number.isFinite(value)),
    );
  } catch {
    return {};
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
  return {
    current: cgroupValue("memory.current", "memory/memory.usage_in_bytes"),
    max: cgroupValue("memory.max", "memory/memory.limit_in_bytes"),
  };
}

function cgroupMemory() {
  const limits = readCgroupMemoryLimits();
  return {
    current: limits.current,
    peak: cgroupValue("memory.peak", "memory/memory.max_usage_in_bytes"),
    max: limits.max,
  };
}

function cgroupMemoryStat() {
  const raw = readKeyValues(cgroupFile("memory.stat"));
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
    kernelMb: bytesToMb(kernel),
    kernelStackMb: bytesToMb(raw.kernel_stack),
    pagetablesMb: bytesToMb(raw.pagetables),
    slabMb: bytesToMb(raw.slab),
    sockMb: bytesToMb(raw.sock),
  };
}

function bytesToMb(value) {
  return value == null ? null : +(value / BYTES_PER_MB).toFixed(1);
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

function mb(value) {
  return +(value / 1024).toFixed(1);
}

export function memorySnapshot(stage) {
  const pids = [process.pid, ...processTree(process.pid)];
  const { nodePss, chromiumPss, otherPss, chromiumProcesses, chromiumByType } =
    collectProcessMemory(pids);
  const cgroup = cgroupMemory();
  const stat = cgroupMemoryStat();
  const events = cgroupMemoryEvents();
  return {
    stage,
    at: new Date().toISOString(),
    nodeRssMb: +(process.memoryUsage().rss / BYTES_PER_MB).toFixed(1),
    nodePssMb: mb(nodePss),
    chromiumPssMb: mb(chromiumPss),
    chromiumPssByTypeMb: Object.fromEntries(
      Object.entries(chromiumByType).map(([type, value]) => [type, mb(value)]),
    ),
    otherProcessPssMb: mb(otherPss),
    cgroupCurrentMb: cgroup.current == null ? null : +(cgroup.current / BYTES_PER_MB).toFixed(1),
    cgroupPeakMb: cgroup.peak == null ? null : +(cgroup.peak / BYTES_PER_MB).toFixed(1),
    cgroupMaxMb: cgroup.max == null ? null : +(cgroup.max / BYTES_PER_MB).toFixed(1),
    cgroup: {
      currentMb: cgroup.current == null ? null : +(cgroup.current / BYTES_PER_MB).toFixed(1),
      peakMb: cgroup.peak == null ? null : +(cgroup.peak / BYTES_PER_MB).toFixed(1),
      maxMb: cgroup.max == null ? null : +(cgroup.max / BYTES_PER_MB).toFixed(1),
      stat,
      events,
    },
    chromiumProcesses,
  };
}
