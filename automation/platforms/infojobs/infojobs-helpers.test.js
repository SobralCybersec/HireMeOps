// Tests infojobs-helpers.js: parseInfojobsDate, isFutureDate, education/managerial level, bestCourseMatch.
import { describe, it, expect } from "vitest";
import { parseInfojobsDate, educationLevelValue, managerialLevelValue } from "./infojobs-helpers.js";

describe("parseInfojobsDate", () => {
  it("parses Portuguese abbreviations to numeric fields", () => {
    expect(parseInfojobsDate("Dez. 2023 - Jan. 2025")).toEqual({
      startMonth: "12",
      startYear: "2023",
      endMonth: "01",
      endYear: "2025",
      current: false,
    });
  });

  it("marks ongoing on Present and clears end", () => {
    expect(parseInfojobsDate("October 2025 - Present")).toEqual({
      startMonth: "10",
      startYear: "2025",
      endMonth: "",
      endYear: "",
      current: true,
    });
  });

  it("parses ISO ranges", () => {
    expect(parseInfojobsDate("2020/02/01 ~ 2023/02/01")).toEqual({
      startMonth: "02",
      startYear: "2020",
      endMonth: "02",
      endYear: "2023",
      current: false,
    });
  });

  it("year-only range keeps both, not current", () => {
    expect(parseInfojobsDate("2023 - 2024")).toMatchObject({
      startYear: "2023",
      endYear: "2024",
      current: false,
    });
  });

  it("lone start year is ongoing", () => {
    expect(parseInfojobsDate("2025")).toMatchObject({ startYear: "2025", current: true });
  });
});

describe("educationLevelValue", () => {
  it("maps common degrees", () => {
    expect(educationLevelValue("Ensino Superior")).toBe("5");
    expect(educationLevelValue("Ciências da Computação")).toBe("5");
    expect(educationLevelValue("Ensino Médio (2º Grau)")).toBe("3");
    expect(educationLevelValue("Pós-graduação MBA")).toBe("6");
    expect(educationLevelValue("Mestrado em X")).toBe("7");
    expect(educationLevelValue("Curso Técnico em Redes")).toBe("4");
  });
});

describe("managerialLevelValue", () => {
  it("guesses from role keywords, defaults Analista", () => {
    expect(managerialLevelValue("Desenvolvedor Sênior")).toBe("10");
    expect(managerialLevelValue("Gerente de TI")).toBe("12");
    expect(managerialLevelValue("Estagiário de Software")).toBe("1");
    expect(managerialLevelValue("Desenvolvedor de Software")).toBe("6");
  });
});

import { isFutureDate } from "./infojobs-helpers.js";
describe("isFutureDate", () => {
  const now = new Date("2026-07-29T00:00:00Z");
  it("future year is future", () => expect(isFutureDate("01", "2029", now)).toBe(true));
  it("later month same year is future", () => expect(isFutureDate("12", "2026", now)).toBe(true));
  it("earlier month same year is not", () => expect(isFutureDate("01", "2026", now)).toBe(false));
  it("past year is not", () => expect(isFutureDate("06", "2025", now)).toBe(false));
  it("year-only current year is not future (assumes Jan)", () => expect(isFutureDate("", "2026", now)).toBe(false));
  it("empty year is not future", () => expect(isFutureDate("", "", now)).toBe(false));
});

import { bestCourseMatch } from "./infojobs-helpers.js";

describe("bestCourseMatch", () => {
  const OPTS = [
    { value: "474", label: "Tecnologia da Informação" },
    { value: "79", label: "Ciências da computação" },
    { value: "88", label: "Segurança da Informação" },
    { value: "90", label: "Engenharia de Software" },
  ];

  it("matches a bacharelado degree to the course, ignoring the level word + accents + plural", () => {
    const m = bestCourseMatch("Bacharelado em Ciência da Computação", OPTS);
    expect(m.value).toBe("79");
    expect(m.score).toBeGreaterThan(0.4);
  });

  it("picks Segurança over Tecnologia da Informação for a cyber-security degree", () => {
    const m = bestCourseMatch("Segurança Cibernética / Cibersegurança", OPTS);
    expect(m.value).toBe("88");
  });

  it("returns a weak/low score when nothing really fits (caller free-texts)", () => {
    const m = bestCourseMatch("Gastronomia", OPTS);
    expect(m === null || m.score < 0.4).toBe(true);
  });

  it("handles empty options", () => {
    expect(bestCourseMatch("Ciência da Computação", [])).toBeNull();
  });
});
