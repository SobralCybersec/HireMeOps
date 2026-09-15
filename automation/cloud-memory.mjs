import { readFileSync, readdirSync } from "node:fs";

function cgroupBytes(file) {
  try {
    const value = readFileSync(file, "utf8").trim();
    return value === "max" ? null : Number(value);
  } catch {
    return null;
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

function cgroupBytesByName(name) {
  const path = processCgroupPath();
  const bases = [];
  if (path && path !== "/") {
    bases.push(`/sys/fs/cgroup${path}`, `/sys/fs/cgroup/memory${path}`);
  }
  bases.push("/sys/fs/cgroup");
  for (const base of bases) {
    const value = cgroupBytes(`${base}/${name}`);
    if (value != null) return value;
  }
  return null;
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

function collectProcessMemory(pids) {
  let nodePss = pssKb(process.pid);
  let chromiumPss = 0;
  let otherPss = 0;
  let chromiumProcesses = 0;
  for (const pid of pids.slice(1)) {
    const name = processName(pid);
    const pss = pssKb(pid);
    if (/chrom|headless_shell/i.test(name)) {
      chromiumPss += pss;
      chromiumProcesses += 1;
    } else if (/node|cloud-runner/i.test(name)) {
      nodePss += pss;
    } else {
      otherPss += pss;
    }
  }
  return { nodePss, chromiumPss, otherPss, chromiumProcesses };
}

function cgroupMemory() {
  return {
    current:
      cgroupBytesByName("memory.current") ?? cgroupBytesByName("memory/memory.usage_in_bytes"),
    peak: cgroupBytesByName("memory.peak") ?? cgroupBytesByName("memory/memory.max_usage_in_bytes"),
  };
}

export function memorySnapshot(stage) {
  const pids = [process.pid, ...processTree(process.pid)];
  const { nodePss, chromiumPss, otherPss, chromiumProcesses } = collectProcessMemory(pids);
  const { current, peak } = cgroupMemory();
  return {
    stage,
    at: new Date().toISOString(),
    nodeRssMb: +(process.memoryUsage().rss / 1_048_576).toFixed(1),
    nodePssMb: +(nodePss / 1024).toFixed(1),
    chromiumPssMb: +(chromiumPss / 1024).toFixed(1),
    otherProcessPssMb: +(otherPss / 1024).toFixed(1),
    cgroupCurrentMb: current == null ? null : +(current / 1_048_576).toFixed(1),
    cgroupPeakMb: peak == null ? null : +(peak / 1_048_576).toFixed(1),
    chromiumProcesses,
  };
}
