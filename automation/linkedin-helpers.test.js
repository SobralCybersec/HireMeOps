// Tests linkedin-helpers.js: PT_MONTH mapping, parseDates range parsing.
import { describe, it, expect } from "vitest";
import { parseDates, PT_MONTH } from "./linkedin-helpers.js";

describe("PT_MONTH", () => {
  it("maps all 12 PT abbreviations to 1-12", () => {
    expect(Object.keys(PT_MONTH)).toHaveLength(12);
    expect(PT_MONTH.jan).toBe(1);
    expect(PT_MONTH.dez).toBe(12);
  });
});

describe("parseDates (LinkedIn month/year selects)", () => {
  it("parses 'month de year' on both ends", () => {
    expect(parseDates("fev de 2026 – fev de 2028")).toEqual({
      startMonth: "2",
      startYear: "2026",
      endMonth: "2",
      endYear: "2028",
    });
  });

  it("parses year-only ranges", () => {
    expect(parseDates("2020–2025")).toEqual({
      startMonth: "",
      startYear: "2020",
      endMonth: "",
      endYear: "2025",
    });
  });

  it("handles a single open-ended start", () => {
    expect(parseDates("jan de 2024")).toEqual({
      startMonth: "1",
      startYear: "2024",
      endMonth: "",
      endYear: "",
    });
  });

  it("splits on hyphen and unicode dashes alike", () => {
    expect(parseDates("mar de 2021 - abr de 2022").endMonth).toBe("4");
    expect(parseDates("mar de 2021 — abr de 2022").endMonth).toBe("4");
  });

  it("leaves month blank for an unknown abbreviation", () => {
    expect(parseDates("xyz de 2020").startMonth).toBe("");
    expect(parseDates("xyz de 2020").startYear).toBe("2020");
  });

  it("returns {} for empty/nullish input", () => {
    expect(parseDates("")).toEqual({});
    expect(parseDates(null)).toEqual({});
    expect(parseDates(undefined)).toEqual({});
  });
});
