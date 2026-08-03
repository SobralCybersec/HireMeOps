// Opt-in performance & memory instrumentation for the Playwright worker (HIREMEOPS_PERF).
// Key: initPerf — starts the event-loop-delay sampler, metrics interval, SIGUSR2 heap snapshot
// Key: sample — per-interval memory/OS/heap/event-loop snapshot, includes browserPssMb
// Key: descendantPids — walks /proc to find every Chromium PID spawned under this worker
// Key: browserPssMb — summed Chromium subtree PSS (RAM invisible to process.memoryUsage())

import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import v8 from "node:v8";
import fs from "node:fs";

const ENABLED = /^(1|true|yes)$/i.test(process.env.HIREMEOPS_PERF ?? "");
const SAMPLE_MS = Number(process.env.HIREMEOPS_PERF_INTERVAL_MS) || 15_000;

const mb = (bytes) => +(bytes / 1_048_576).toFixed(1);
const nsToMs = (ns) => +(Number(ns) / 1e6).toFixed(2);

function emit(obj) {
  process.stderr.write(`[perf] ${JSON.stringify(obj)}\n`);
}

let eld = null;

function pssKb(pid) {
  try {
    const m = /^Pss:\s+(\d+)/m.exec(fs.readFileSync(`/proc/${pid}/smaps_rollup`, "utf8"));
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

export function descendantPids(root) {
  const kids = new Map();
  let entries;
  try {
    entries = fs.readdirSync("/proc");
  } catch {
    return [];
  }
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const st = fs.readFileSync(`/proc/${name}/status`, "utf8");
      const m = /^PPid:\s+(\d+)/m.exec(st);
      if (!m) continue;
      const pp = Number(m[1]);
      if (!kids.has(pp)) kids.set(pp, []);
      kids.get(pp).push(Number(name));
    } catch {
    }
  }
  const out = [];
  const stack = [root];
  while (stack.length) {
    for (const c of kids.get(stack.pop()) ?? []) {
      out.push(c);
      stack.push(c);
    }
  }
  return out;
}

export function perfEnabled() {
  return ENABLED;
}

export function nowMs() {
  return performance.now();
}

export function logSpan(event, fields) {
  if (!ENABLED) return;
  emit({ event, ...fields });
}

function sample() {
  const m = process.memoryUsage();
  const ru = process.resourceUsage();
  const hs = v8.getHeapStatistics();
  const snap = {
    event: "sample",
    rssMb: mb(m.rss),
    heapUsedMb: mb(m.heapUsed),
    externalMb: mb(m.external),
    arrayBuffersMb: mb(m.arrayBuffers),
    maxRssMb: +(ru.maxRSS / 1024).toFixed(1),
    heapLimitPct: +(hs.used_heap_size / hs.heap_size_limit).toFixed(3),
    nativeContexts: hs.number_of_native_contexts,
    detachedContexts: hs.number_of_detached_contexts,
  };
  if (eld) {
    snap.eldMeanMs = nsToMs(eld.mean);
    snap.eldP99Ms = nsToMs(eld.percentile(99));
    snap.eldMaxMs = nsToMs(eld.max);
    eld.reset();
  }
  const kids = descendantPids(process.pid);
  if (kids.length) {
    let sumKb = 0;
    for (const p of kids) sumKb += pssKb(p);
    snap.browserPssMb = mb(sumKb * 1024);
    snap.browserProcs = kids.length;
  }
  emit(snap);
}

export function initPerf() {
  if (!ENABLED) return { enabled: false };

  eld = monitorEventLoopDelay({ resolution: 20 });
  eld.enable();

  const timer = setInterval(sample, SAMPLE_MS);
  timer.unref();

  process.on("SIGUSR2", () => {
    try {
      const file = v8.writeHeapSnapshot();
      emit({ event: "heapSnapshot", file });
    } catch (e) {
      emit({ event: "heapSnapshot", error: String(e?.message ?? e) });
    }
  });

  emit({ event: "start", pid: process.pid, intervalMs: SAMPLE_MS });
  return { enabled: true };
}
