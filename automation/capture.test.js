// Tests attachNetworkCapture: JSON/fetch response buffering, size caps, ring buffer.
import { describe, it, expect } from "vitest";
import { attachNetworkCapture } from "./capture.js";

function fakeContext() {
  const handlers = {};
  return {
    on(event, fn) {
      handlers[event] = fn;
    },
    emitResponse(resp) {
      handlers.response?.(resp);
    },
  };
}

function fakeResponse({ url = "https://x/api", method = "GET", status = 200, type = "fetch", ct = "application/json", body = "{}", contentLength } = {}) {
  const headers = { "content-type": ct };
  if (contentLength != null) headers["content-length"] = String(contentLength);
  return {
    url: () => url,
    status: () => status,
    headers: () => headers,
    request: () => ({ method: () => method, resourceType: () => type }),
    text: async () => body,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("attachNetworkCapture", () => {
  it("captures a JSON 200 with its body", async () => {
    const ctx = fakeContext();
    attachNetworkCapture(ctx);
    ctx.emitResponse(fakeResponse({ url: "https://s/search", body: '{"jobs":3}' }));
    await flush();
    expect(ctx.__net).toHaveLength(1);
    expect(ctx.__net[0]).toMatchObject({ url: "https://s/search", status: 200, body: '{"jobs":3}' });
  });

  it("skips 3xx (body unavailable), 204 and 304", async () => {
    const ctx = fakeContext();
    attachNetworkCapture(ctx);
    ctx.emitResponse(fakeResponse({ status: 302 }));
    ctx.emitResponse(fakeResponse({ status: 204 }));
    ctx.emitResponse(fakeResponse({ status: 304 }));
    await flush();
    expect(ctx.__net).toHaveLength(0);
  });

  it("skips non-JSON that isn't a fetch/xhr", async () => {
    const ctx = fakeContext();
    attachNetworkCapture(ctx);
    ctx.emitResponse(fakeResponse({ ct: "text/html", type: "document" }));
    await flush();
    expect(ctx.__net).toHaveLength(0);
  });

  it("keeps a non-json content-type when it rides on a fetch (e.g. GraphQL)", async () => {
    const ctx = fakeContext();
    attachNetworkCapture(ctx);
    ctx.emitResponse(fakeResponse({ ct: "text/plain", type: "fetch", body: "data" }));
    await flush();
    expect(ctx.__net).toHaveLength(1);
  });

  it("skips a body over the size cap via content-length without reading it", async () => {
    const ctx = fakeContext();
    attachNetworkCapture(ctx);
    ctx.emitResponse(fakeResponse({ contentLength: 200_000 }));
    await flush();
    expect(ctx.__net[0].body).toMatch(/skipped/);
  });

  it("truncates an oversized body it did read", async () => {
    const ctx = fakeContext();
    attachNetworkCapture(ctx);
    ctx.emitResponse(fakeResponse({ body: "x".repeat(80_000) }));
    await flush();
    expect(ctx.__net[0].body).toMatch(/…\[truncated\]$/);
    expect(ctx.__net[0].body.length).toBeLessThan(80_000);
  });

  it("ring-buffers past the cap and is idempotent per context", async () => {
    const ctx = fakeContext();
    attachNetworkCapture(ctx);
    attachNetworkCapture(ctx);
    for (let i = 0; i < 130; i++) ctx.emitResponse(fakeResponse({ body: `{"i":${i}}` }));
    await flush();
    expect(ctx.__net.length).toBeLessThanOrEqual(120);
    expect(ctx.__net.at(-1).body).toBe('{"i":129}');
  });
});
