// Tests catho-jobs.js: cathoSlug slugification, buildCathoSearchUrl query shape.
import { describe, it, expect } from "vitest";
import { buildCathoSearchUrl, cathoSlug } from "./catho-jobs.js";

describe("cathoSlug", () => {
  it("slugifies a title, stripping accents and punctuation", () => {
    expect(cathoSlug("Desenvolvedor Back-End")).toBe("desenvolvedor-back-end");
    expect(cathoSlug("Analista de Sistemas Sênior")).toBe("analista-de-sistemas-senior");
    expect(cathoSlug("  C# / .NET Pleno  ")).toBe("c-net-pleno");
  });
  it("returns '' for empty/nullish", () => {
    expect(cathoSlug("")).toBe("");
    expect(cathoSlug(null)).toBe("");
  });
});

describe("buildCathoSearchUrl", () => {
  it("matches the documented query shape", () => {
    expect(
      buildCathoSearchUrl({
        query: "desenvolvedor back end",
        areaIds: [51, 52],
        workModels: ["remote", "hybrid"],
        lastDays: 7,
      }),
    ).toBe(
      "https://www.catho.com.br/vagas/desenvolvedor-back-end/" +
        "?area_id[0]=51&area_id[1]=52&work_model[0]=remote&work_model[1]=hybrid&lastdays=7",
    );
  });
  it("omits lastdays when not provided (any date)", () => {
    const url = buildCathoSearchUrl({ query: "dev", areaIds: [51], workModels: ["remote"] });
    expect(url).toBe(
      "https://www.catho.com.br/vagas/dev/?area_id[0]=51&work_model[0]=remote",
    );
    expect(url).not.toContain("lastdays");
  });
  it("produces a bare slug URL with no params", () => {
    expect(buildCathoSearchUrl({ query: "Programador Web" })).toBe(
      "https://www.catho.com.br/vagas/programador-web/",
    );
  });
  it("omits page for page 1, appends ?page=N for N>1", () => {
    expect(buildCathoSearchUrl({ query: "dev", page: 1 })).toBe(
      "https://www.catho.com.br/vagas/dev/",
    );
    expect(buildCathoSearchUrl({ query: "dev", page: 3 })).toBe(
      "https://www.catho.com.br/vagas/dev/?page=3",
    );
    expect(buildCathoSearchUrl({ query: "dev", workModels: ["remote"], page: 2 })).toBe(
      "https://www.catho.com.br/vagas/dev/?work_model[0]=remote&page=2",
    );
  });
});
