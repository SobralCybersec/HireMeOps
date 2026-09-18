import { describe, expect, it, vi } from "vitest";
import { createNavigationTelemetry } from "./cloud-navigation-telemetry.mjs";

function fakePage() {
  const listeners = new Map();
  return {
    on: (event, listener) => listeners.set(event, listener),
    off: vi.fn((event) => listeners.delete(event)),
    emit: (event, value) => listeners.get(event)?.(value),
  };
}

function request(url, type, failure) {
  return {
    url: () => url,
    resourceType: () => type,
    failure: () => (failure ? { errorText: failure } : null),
  };
}

describe("cloud navigation telemetry", () => {
  it("keeps requests pending after headers until the download finishes", () => {
    const page = fakePage();
    const telemetry = createNavigationTelemetry(page);
    const script = request("https://static.licdn.com/app.js?token=secret", "script");
    page.emit("request", script);
    expect(telemetry.snapshot().oldestPending.phase).toBe("awaiting_headers");
    page.emit("response", { request: () => script, status: () => 200 });
    expect(telemetry.snapshot()).toMatchObject({
      scriptResponses2xx: 1,
      pendingRequestsTotal: 1,
      pendingByType: { script: 1 },
      oldestPending: { phase: "downloading" },
      finishedRequestsByType: { script: 0 },
    });
    page.emit("requestfinished", script);
    expect(telemetry.snapshot()).toMatchObject({
      pendingRequestsTotal: 0,
      oldestPending: null,
      finishedRequestsByType: { script: 1 },
    });
    telemetry.detach();
  });

  it("removes a request failing after headers without counting it as finished", () => {
    const page = fakePage();
    const telemetry = createNavigationTelemetry(page);
    const script = request(
      "https://static.licdn.com/app.js",
      "script",
      "net::ERR_CONNECTION_RESET",
    );
    page.emit("request", script);
    page.emit("response", { request: () => script, status: () => 200 });
    page.emit("requestfailed", script);
    expect(telemetry.snapshot()).toMatchObject({
      pendingRequestsTotal: 0,
      scriptFailures: 1,
      finishedRequestsByType: { script: 0 },
    });
    telemetry.detach();
  });

  it("reports pending requests by type and host without retaining URLs", () => {
    const page = fakePage();
    const telemetry = createNavigationTelemetry(page);
    page.emit("request", request("https://static.licdn.com/pending.js?token=secret", "script"));

    const snapshot = telemetry.snapshot();
    expect(snapshot).toMatchObject({
      pendingRequestsTotal: 1,
      pendingByType: { script: 1 },
      pendingByHostBucket: { licdn: 1 },
      oldestPending: {
        type: "script",
        host: "licdn",
        pathnameHash: expect.stringMatching(/^[a-f0-9]{12}$/),
      },
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/licdn\.com|token|secret/i);
    telemetry.detach();
  });

  it("aggregates request metadata without retaining URLs or bodies", () => {
    const page = fakePage();
    const telemetry = createNavigationTelemetry(page, { resourcePolicyEnabled: true });
    page.emit("request", request("https://www.linkedin.com/app.js?token=secret", "script"));
    page.emit("request", request("https://static.licdn.com/app.css", "stylesheet"));
    page.emit("response", {
      request: () => request("https://www.linkedin.com/app.js", "script"),
      status: () => 200,
    });
    page.emit(
      "requestfailed",
      request("https://www.linkedin.com/image.png", "image", "net::ERR_BLOCKED_BY_CLIENT"),
    );
    page.emit("console", { type: () => "error" });
    page.emit("pageerror", new Error("secret"));

    const snapshot = telemetry.snapshot();
    expect(snapshot).toMatchObject({
      resourcePolicyEnabled: true,
      requestsTotal: 2,
      scriptRequests: 1,
      scriptResponses2xx: 1,
      failedReasons: { blocked_by_policy: 1 },
      consoleErrorCount: 1,
      pageErrorCount: 1,
      hostBuckets: { linkedin: 1, licdn: 1 },
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/linkedin\.com|token|secret|body/i);
    telemetry.detach();
    expect(page.off).toHaveBeenCalledTimes(6);
  });
});
