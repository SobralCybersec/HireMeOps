import { describe, expect, it } from "vitest";
import { fetchLinkedInJobDetail } from "./worker-linkedin.js";

function response({ ok = true, json = async () => ({ description: { text: "Role" } }) } = {}) {
  let disposed = 0;
  return {
    ok: () => ok,
    json,
    dispose: async () => {
      disposed += 1;
    },
    get disposed() {
      return disposed;
    },
  };
}

function pageWith(responses) {
  return {
    request: {
      get: async () => responses.shift(),
    },
  };
}

describe("LinkedIn job detail response lifecycle", () => {
  it("disposes successful response after consuming JSON", async () => {
    const current = response();
    await fetchLinkedInJobDetail(pageWith([current]), "csrf", "job-1");
    expect(current.disposed).toBe(1);
  });

  it("disposes non-OK responses on every attempt", async () => {
    const first = response({ ok: false });
    const second = response({ ok: false });
    await fetchLinkedInJobDetail(pageWith([first, second]), "csrf", "job-1");
    expect(first.disposed).toBe(1);
    expect(second.disposed).toBe(1);
  });

  it("disposes responses when JSON parsing fails", async () => {
    const first = response({
      json: async () => {
        throw new Error("fixture parse failure");
      },
    });
    const second = response({
      json: async () => {
        throw new Error("fixture parse failure");
      },
    });
    await fetchLinkedInJobDetail(pageWith([first, second]), "csrf", "job-1");
    expect(first.disposed).toBe(1);
    expect(second.disposed).toBe(1);
  });
});
