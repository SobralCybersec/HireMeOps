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
    expect(page.off).toHaveBeenCalledTimes(5);
  });
});
