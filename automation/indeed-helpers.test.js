// Tests classifyIndeedQuestion: consent/auth/unverifiable/default bucket classification.
import { describe, it, expect } from "vitest";
import { classifyIndeedQuestion } from "./indeed-helpers.js";

describe("classifyIndeedQuestion", () => {
  it("flags LGPD / consent / legal declarations as consent (never auto-answered)", () => {
    expect(classifyIndeedQuestion("Você está ciente e consente com o tratamento dos seus dados?")).toBe("consent");
    expect(classifyIndeedQuestion("Autorizo a verificação de antecedentes (background check)")).toBe("consent");
    expect(classifyIndeedQuestion("Declaro que as informações são verdadeiras")).toBe("consent");
    expect(classifyIndeedQuestion("I consent to the processing of my personal data (LGPD 13.709)")).toBe("consent");
  });

  it("flags work-authorization questions as auth (answered 'Sim', not 'Não')", () => {
    expect(classifyIndeedQuestion("Você está legalmente autorizado a trabalhar no Brasil?")).toBe("auth");
    expect(classifyIndeedQuestion("Are you legally authorized to work in this country?")).toBe("auth");
    expect(classifyIndeedQuestion("É elegível para trabalhar no país?")).toBe("auth");
  });

  it("flags unverifiable experience / license questions for the human", () => {
    expect(classifyIndeedQuestion("Quantos anos de experiência você tem com Rust?")).toBe("unverifiable");
    expect(classifyIndeedQuestion("How many years of experience do you have?")).toBe("unverifiable");
    expect(classifyIndeedQuestion("Você possui CNH categoria B válida?")).toBe("unverifiable");
  });

  it("defaults everything else (sponsorship, relocation, on-site) to 'Não'", () => {
    expect(classifyIndeedQuestion("Você precisa de patrocínio de visto?")).toBe("default");
    expect(classifyIndeedQuestion("Are you willing to relocate?")).toBe("default");
    expect(classifyIndeedQuestion("Do you have a relative working here?")).toBe("default");
  });

  it("consent wins when a question is both consent and authorization", () => {
    expect(
      classifyIndeedQuestion("Declaro estar autorizado a trabalhar e consinto com a verificação"),
    ).toBe("consent");
  });

  it("handles empty / nullish labels as default", () => {
    expect(classifyIndeedQuestion("")).toBe("default");
    expect(classifyIndeedQuestion(null)).toBe("default");
    expect(classifyIndeedQuestion(undefined)).toBe("default");
  });
});
