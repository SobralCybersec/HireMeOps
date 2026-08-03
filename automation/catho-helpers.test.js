// Tests catho-helpers.js: metadata parsing, date parsing, bullet formatting, degree mapping.
import { describe, it, expect } from "vitest";
import {
  cathoParseMeta,
  cathoParseDates,
  cathoMonthYear,
  cathoDegreeValue,
  cathoBulletList,
} from "./catho-helpers.js";

describe("cathoParseMeta", () => {
  it("parses a JSON string", () => {
    expect(cathoParseMeta('{"title":"Dev"}')).toEqual({ title: "Dev" });
  });
  it("passes a plain object through", () => {
    const o = { a: 1 };
    expect(cathoParseMeta(o)).toBe(o);
  });
  it("returns {} for null/undefined/empty", () => {
    expect(cathoParseMeta(null)).toEqual({});
    expect(cathoParseMeta(undefined)).toEqual({});
    expect(cathoParseMeta("")).toEqual({});
  });
  it("returns {} on malformed JSON instead of throwing", () => {
    expect(cathoParseMeta("{not json")).toEqual({});
  });
});

describe("cathoParseDates", () => {
  it("parses a closed range", () => {
    expect(cathoParseDates("02/2020 - 02/2022")).toEqual({
      start: "02/2020",
      end: "02/2022",
      current: false,
    });
  });
  it("flags open-ended roles and blanks the end", () => {
    expect(cathoParseDates("12/2023 - Atual")).toEqual({
      start: "12/2023",
      end: "",
      current: true,
    });
    expect(cathoParseDates("10/2025 - Cursando").current).toBe(true);
    expect(cathoParseDates("01/2025 - Em andamento").current).toBe(true);
  });
  it("zero-pads single-digit months", () => {
    expect(cathoParseDates("1/2023 - 9/2024")).toEqual({
      start: "01/2023",
      end: "09/2024",
      current: false,
    });
  });
  it("handles unicode dashes", () => {
    expect(cathoParseDates("03/2019 – 06/2020").end).toBe("06/2020");
  });
  it("returns empty fields for junk input", () => {
    expect(cathoParseDates("")).toEqual({ start: "", end: "", current: false });
    expect(cathoParseDates(null)).toEqual({ start: "", end: "", current: false });
    expect(cathoParseDates("no dates here")).toEqual({ start: "", end: "", current: false });
  });
  it("parses PT/EN month names into MM/YYYY", () => {
    expect(cathoParseDates("abril de 2025 - atual")).toEqual({
      start: "04/2025",
      end: "",
      current: true,
    });
    expect(cathoParseDates("Jan 2024 – Dez 2024")).toEqual({
      start: "01/2024",
      end: "12/2024",
      current: false,
    });
  });
  it("defaults a year-only endpoint to January so the field is valid", () => {
    expect(cathoParseDates("2025 - Presente")).toEqual({
      start: "01/2025",
      end: "",
      current: true,
    });
  });
  it("splits on 'até' / 'a' word separators", () => {
    expect(cathoParseDates("03/2021 até 06/2022").end).toBe("06/2022");
  });
  it("does not split a numeric MM-YYYY with no spaces", () => {
    expect(cathoParseDates("04/2025").start).toBe("04/2025");
  });
  it("defaults an invalid month to the year (01)", () => {
    expect(cathoParseDates("13/2020 - 02/2021").start).toBe("01/2020");
  });
});

describe("cathoMonthYear", () => {
  it("normalizes each accepted shape to MM/YYYY", () => {
    expect(cathoMonthYear("04/2025")).toBe("04/2025");
    expect(cathoMonthYear("4/2025")).toBe("04/2025");
    expect(cathoMonthYear("abril de 2025")).toBe("04/2025");
    expect(cathoMonthYear("Fev 2026")).toBe("02/2026");
    expect(cathoMonthYear("March 2025")).toBe("03/2025");
    expect(cathoMonthYear("2025")).toBe("01/2025");
  });
  it("returns '' when there's no parseable year", () => {
    expect(cathoMonthYear("")).toBe("");
    expect(cathoMonthYear("sometime")).toBe("");
  });
});

describe("cathoBulletList", () => {
  it("prefixes each line with a bullet and separates by a blank line", () => {
    expect(cathoBulletList(["Fez X", "Fez Y"])).toBe("• Fez X\n\n• Fez Y");
  });
  it("leaves an already-bulleted line and the Tech Stack line unprefixed", () => {
    expect(cathoBulletList(["• Já tem", "Tech Stack: Java, React"])).toBe(
      "• Já tem\n\nTech Stack: Java, React",
    );
  });
  it("trims and drops blank entries", () => {
    expect(cathoBulletList(["  Fez X  ", "", "  "])).toBe("• Fez X");
  });
  it("returns empty string for non-arrays / empty", () => {
    expect(cathoBulletList(undefined)).toBe("");
    expect(cathoBulletList([])).toBe("");
    expect(cathoBulletList(null)).toBe("");
  });
});

describe("cathoDegreeValue", () => {
  it("maps each level by keyword", () => {
    expect(cathoDegreeValue("Mestrado em CC")).toBe("4");
    expect(cathoDegreeValue("Doutorado")).toBe("5");
    expect(cathoDegreeValue("MBA em Gestão")).toBe("3");
    expect(cathoDegreeValue("Pós-graduação")).toBe("2");
    expect(cathoDegreeValue("Curso Técnico")).toBe("8");
    expect(cathoDegreeValue("Ensino Médio")).toBe("9");
  });
  it("defaults undergraduate/unknown to Graduação (1)", () => {
    expect(cathoDegreeValue("Graduação")).toBe("1");
    expect(cathoDegreeValue("Bacharelado em Ciência da Computação")).toBe("1");
    expect(cathoDegreeValue("")).toBe("1");
    expect(cathoDegreeValue(null)).toBe("1");
  });
  it("is accent- and case-insensitive", () => {
    expect(cathoDegreeValue("MEDIO")).toBe("9");
    expect(cathoDegreeValue("tecnico")).toBe("8");
  });
});
