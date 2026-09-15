import { describe, it, expect } from "vitest";
import { extractAssunto } from "./JobSearch.helpers";

describe("extractAssunto", () => {
  it("returns null for empty / null input", () => {
    expect(extractAssunto(null)).toBeNull();
    expect(extractAssunto(undefined)).toBeNull();
    expect(extractAssunto("")).toBeNull();
  });

  it("matches Portuguese 'Assunto:'", () => {
    expect(extractAssunto("Assunto: Vaga de Developer")).toBe("Vaga de Developer");
  });

  it("matches English 'Subject:'", () => {
    expect(extractAssunto("Subject: Senior Engineer Application")).toBe(
      "Senior Engineer Application",
    );
  });

  it("is case-insensitive", () => {
    expect(extractAssunto("ASSUNTO: Teste")).toBe("Teste");
    expect(extractAssunto("subject: Hello")).toBe("Hello");
  });

  it("accepts dash separator", () => {
    expect(extractAssunto("Assunto - Candidatura React Dev")).toBe("Candidatura React Dev");
  });

  it("trims whitespace", () => {
    expect(extractAssunto("Assunto:   Espaços   ")).toBe("Espaços");
  });

  it("caps at 120 chars", () => {
    const long = "x".repeat(200);
    expect(extractAssunto(`Assunto: ${long}`)?.length).toBe(120);
  });

  it("returns null when pattern absent", () => {
    expect(extractAssunto("No subject line here at all.")).toBeNull();
  });
});
