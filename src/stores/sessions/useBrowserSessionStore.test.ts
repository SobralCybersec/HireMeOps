import { beforeEach, describe, expect, it } from "vitest";
import { useBrowserSessionStore } from "./useBrowserSessionStore";

describe("useBrowserSessionStore", () => {
  beforeEach(() => useBrowserSessionStore.getState().clear());

  it("updates only the profile and platform carried by session events", () => {
    useBrowserSessionStore.getState().applyEvent({
      id: "event-1",
      type: "browser.session.status",
      profileId: "profile-a",
      payload: { platform: "linkedin", status: "valid" },
      createdAt: "2026-01-01T00:00:00Z",
    });

    expect(useBrowserSessionStore.getState().statuses).toEqual({
      "profile-a": { linkedin: "valid" },
    });
  });
});
