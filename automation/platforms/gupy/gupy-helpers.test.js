// Tests gupy-helpers.js: parseGupyDate, gupyActivities, skillKey.
import { describe, it, expect } from "vitest";
import { parseGupyDate, gupyActivities, skillKey } from "./gupy-helpers.js";

describe("parseGupyDate", () => {
  it("parses an English month/year range", () => {
    expect(parseGupyDate("December 2023 - May 2024")).toEqual({
      startMonth: "December",
      startYear: "2023",
      endMonth: "May",
      endYear: "2024",
      current: false,
    });
  });

  it("maps abbreviations and marks ongoing on 'Present'", () => {
    expect(parseGupyDate("Oct 2025 - Present")).toEqual({
      startMonth: "October",
      startYear: "2025",
      endMonth: "",
      endYear: "",
      current: true,
    });
  });

  it("handles Portuguese months and 'atual'", () => {
    expect(parseGupyDate("fev/2026 - atual")).toEqual({
      startMonth: "February",
      startYear: "2026",
      endMonth: "",
      endYear: "",
      current: true,
    });
  });

  it("treats a lone start year as ongoing", () => {
    const r = parseGupyDate("2023");
    expect(r.startYear).toBe("2023");
    expect(r.current).toBe(true);
    expect(r.endYear).toBe("");
  });

  it("year-only range keeps both ends and is not current", () => {
    expect(parseGupyDate("2023 - 2024")).toMatchObject({
      startYear: "2023",
      endYear: "2024",
      current: false,
    });
  });

  it("empty string yields all-empty", () => {
    expect(parseGupyDate("")).toEqual({
      startMonth: "",
      startYear: "",
      endMonth: "",
      endYear: "",
      current: false,
    });
  });
});

describe("gupyActivities", () => {
  it("dash-prefixes and blank-line-joins bullets", () => {
    expect(gupyActivities(["Built X", "Shipped Y"])).toBe("- Built X\n\n- Shipped Y");
  });

  it("keeps existing dash/bullet prefixes", () => {
    expect(gupyActivities(["- already", "• dot"])).toBe("- already\n\n• dot");
  });

  it("drops blanks and accepts a bare string", () => {
    expect(gupyActivities(["", "  ", "One"])).toBe("- One");
    expect(gupyActivities("Solo")).toBe("- Solo");
  });
});

describe("skillKey", () => {
  it("is case- and whitespace-insensitive", () => {
    expect(skillKey("  Spring   Boot ")).toBe("spring boot");
    expect(skillKey("JAVA")).toBe(skillKey("java"));
  });
});
