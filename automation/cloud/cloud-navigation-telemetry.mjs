import { createHash } from "node:crypto";

const RESOURCE_TYPES = [
  "document",
  "script",
  "stylesheet",
  "xhr",
  "fetch",
  "image",
  "media",
  "font",
  "other",
];

function resourceType(value) {
  try {
    const type = typeof value?.resourceType === "function" ? value.resourceType() : value?.type;
    return RESOURCE_TYPES.includes(type) ? type : "other";
  } catch {
    return "other";
  }
}

function hostBucket(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    if (hostname === "linkedin.com" || hostname.endsWith(".linkedin.com")) return "linkedin";
    if (hostname === "licdn.com" || hostname.endsWith(".licdn.com")) return "licdn";
  } catch {}
  return "other";
}

function pathnameHash(value) {
  try {
    return createHash("sha256")
      .update(new URL(value).pathname)
      .digest("hex")
      .slice(0, 12);
  } catch {
    return null;
  }
}

function statusClass(status) {
  const group = Math.floor(Number(status) / 100);
  return group >= 2 && group <= 5 ? `${group}xx` : "other";
}

function failedReason(request) {
  try {
    const reason = String(request.failure?.()?.errorText ?? "").toLowerCase();
    if (/blocked.?by.?client|blockedbyclient/.test(reason)) return "blocked_by_policy";
    if (/timeout|timed out/.test(reason)) return "timeout";
    if (/connection|network|dns|reset|refused/.test(reason)) return "connection";
  } catch {}
  return "other";
}

function emptyCounts() {
  return Object.fromEntries(RESOURCE_TYPES.map((type) => [type, 0]));
}

function emptyResponseCounts() {
  return Object.fromEntries(
    RESOURCE_TYPES.map((type) => [type, { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 }]),
  );
}

function listenerApi(page) {
  const add = typeof page?.on === "function" ? (event, listener) => page.on(event, listener) : null;
  const remove =
    typeof page?.off === "function" ? (event, listener) => page.off(event, listener) : null;
  return { add, remove };
}

export function createNavigationTelemetry(page, { resourcePolicyEnabled = false } = {}) {
  const requestsByType = emptyCounts();
  const responsesByType = emptyResponseCounts();
  const responsesByClass = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 };
  const failedRequestsByType = emptyCounts();
  const failedReasons = { blocked_by_policy: 0, timeout: 0, connection: 0, other: 0 };
  const hostBuckets = { linkedin: 0, licdn: 0, other: 0 };
  const pendingRequests = new Map();
  let requestsTotal = 0;
  let pageErrorCount = 0;
  let consoleErrorCount = 0;

  const onRequest = (request) => {
    const type = resourceType(request);
    requestsTotal += 1;
    requestsByType[type] += 1;
    const host = hostBucket(request.url?.());
    hostBuckets[host] += 1;
    pendingRequests.set(request, {
      type,
      host,
      pathnameHash: pathnameHash(request.url?.()),
      startedAt: Date.now(),
    });
  };
  const onResponse = (response) => {
    const request = response.request?.();
    pendingRequests.delete(request);
    const type = resourceType(request);
    const group = statusClass(response.status?.());
    responsesByType[type][group] += 1;
    responsesByClass[group] += 1;
  };
  const onRequestFailed = (request) => {
    pendingRequests.delete(request);
    const type = resourceType(request);
    const reason = failedReason(request);
    failedRequestsByType[type] += 1;
    failedReasons[reason] += 1;
  };
  const onPageError = () => {
    pageErrorCount += 1;
  };
  const onConsole = (message) => {
    try {
      if (message.type?.() === "error") consoleErrorCount += 1;
    } catch {}
  };

  const { add, remove } = listenerApi(page);
  if (add) {
    add("request", onRequest);
    add("response", onResponse);
    add("requestfailed", onRequestFailed);
    add("pageerror", onPageError);
    add("console", onConsole);
  }

  return {
    snapshot() {
      const typesValue = (values, type) => values[type] ?? 0;
      const xhrFetch = ["xhr", "fetch"];
      const sum = (types, values) =>
        types.reduce((total, type) => total + typesValue(values, type), 0);
      const xhrFetchResponses = (group) =>
        xhrFetch.reduce((total, type) => total + responsesByType[type][group], 0);
      const pendingByType = emptyCounts();
      const pendingByHostBucket = { linkedin: 0, licdn: 0, other: 0 };
      let oldestPendingAgeMs = null;
      let oldestPending = null;
      const now = Date.now();
      for (const pending of pendingRequests.values()) {
        const ageMs = now - pending.startedAt;
        pendingByType[pending.type] += 1;
        pendingByHostBucket[pending.host] += 1;
        if (oldestPendingAgeMs == null || ageMs > oldestPendingAgeMs) {
          oldestPendingAgeMs = ageMs;
          oldestPending = {
            type: pending.type,
            host: pending.host,
            pathnameHash: pending.pathnameHash,
            ageMs,
          };
        }
      }
      return {
        resourcePolicyEnabled,
        requestsTotal,
        requestsByType: { ...requestsByType },
        responsesByClass: { ...responsesByClass },
        responsesByType: Object.fromEntries(
          RESOURCE_TYPES.map((type) => [type, { ...responsesByType[type] }]),
        ),
        failedRequestsByType: { ...failedRequestsByType },
        failedReasons: { ...failedReasons },
        hostBuckets: { ...hostBuckets },
        pendingRequestsTotal: pendingRequests.size,
        pendingByType,
        pendingByHostBucket,
        oldestPendingAgeMs,
        oldestPending,
        scriptRequests: requestsByType.script,
        scriptResponses2xx: responsesByType.script["2xx"],
        scriptResponses4xx: responsesByType.script["4xx"],
        scriptResponses5xx: responsesByType.script["5xx"],
        scriptFailures: failedRequestsByType.script,
        xhrFetchRequests: sum(xhrFetch, requestsByType),
        xhrFetch2xx: xhrFetchResponses("2xx"),
        xhrFetch4xx: xhrFetchResponses("4xx"),
        xhrFetch5xx: xhrFetchResponses("5xx"),
        xhrFetchFailures: sum(xhrFetch, failedRequestsByType),
        pageErrorCount,
        consoleErrorCount,
      };
    },
    detach() {
      pendingRequests.clear();
      if (!remove) return;
      remove("request", onRequest);
      remove("response", onResponse);
      remove("requestfailed", onRequestFailed);
      remove("pageerror", onPageError);
      remove("console", onConsole);
    },
  };
}
