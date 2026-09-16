import { describe, expect, it } from "vitest";
import { formatBytes, MOCK_HISTORY, MOCK_LIBRARY, relativeTime } from "./mockData";

describe("CV mock data helpers", () => {
  it("keeps library and history fixtures linked", () => {
    expect(MOCK_LIBRARY).toHaveLength(2);
    expect(MOCK_HISTORY).toHaveLength(3);
    expect(
      MOCK_HISTORY.every((row) => MOCK_LIBRARY.some((doc) => doc.id === row.cvDocumentId)),
    ).toBe(true);
  });

  it("formats byte sizes and relative timestamps", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(relativeTime(null)).toBe("never");
    expect(relativeTime(new Date().toISOString())).toBe("just now");
    expect(relativeTime(new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())).toBe("2h ago");
    expect(relativeTime(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())).toBe(
      "3d ago",
    );
  });
});
