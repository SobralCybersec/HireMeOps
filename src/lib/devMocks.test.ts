// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMockResponse, isMockEnabled, mockSearchTemplates } from "./devMocks";
import { seedDevState } from "./devMockSeed";

describe("development mock boundary", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_ENABLE_MOCKS", "false");
  });

  it("returns synthetic data only for known commands", () => {
    expect(getMockResponse("list_profiles")).toHaveLength(3);
    expect(getMockResponse("get_settings")).toMatchObject({ activeProfileId: "prof-1" });
    expect(getMockResponse("list_cv_documents")).toHaveLength(2);
    expect(getMockResponse("list_cv_analysis_reports")).toHaveLength(3);
    expect(getMockResponse("create_first_time_cv_rewrite")).toBe("mock-first-cv-rewrite");
    expect(ArrayBuffer.isView(getMockResponse("cv_read_bytes", { cvId: "cv1" }))).toBe(true);
    expect(getMockResponse("cv_read_bytes", { cvId: "cv2" })).toBeNull();
    expect(getMockResponse("cv_read_bytes", { cvId: "other" })).toBeUndefined();
    expect(getMockResponse("cv_read_bytes")).toBeUndefined();
    expect(getMockResponse("cv_read_bytes", { cvId: 42 })).toBeUndefined();
    expect(getMockResponse("automation_start")).toBeNull();
    expect(getMockResponse("unknown_command")).toBeUndefined();
  });

  it("keeps mocks disabled outside explicit preview mode", () => {
    expect(isMockEnabled()).toBe(false);
    expect(mockSearchTemplates()).toEqual([]);
    seedDevState();
  });

  it("seeds stores in explicit preview mode", () => {
    vi.stubEnv("VITE_ENABLE_MOCKS", "true");
    expect(isMockEnabled()).toBe(true);
    expect(mockSearchTemplates()).toHaveLength(3);
    seedDevState();
  });
});
