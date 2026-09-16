import { describe, expect, it } from "vitest";
import { extractAssunto, extractPhone, workModelsFrom } from "./JobSearch.helpers";

describe("job search helpers", () => {
  it("derives stable work models from localized preferences", () => {
    expect(workModelsFrom(["Remoto", "Híbrido", "Presencial"])).toEqual([
      "remote",
      "hybrid",
      "onsite",
    ]);
    expect(workModelsFrom(["office", "home office"])).toEqual(["remote"]);
    expect(workModelsFrom(["local"])).toEqual(["onsite"]);
    expect(workModelsFrom([])).toEqual([]);
  });

  it("extracts bounded subject and Brazilian phone forms", () => {
    expect(extractAssunto("Assunto:  Backend Engineer  ")).toBe("Backend Engineer");
    expect(extractAssunto("Subject - Apply today")).toBe("Apply today");
    expect(extractAssunto("No subject")).toBeNull();
    expect(extractAssunto(null)).toBeNull();
    expect(extractPhone("Contato: (11) 91234-5678")).toBe("(11) 91234-5678");
    expect(extractPhone("WhatsApp 1234-5678")).toBe("1234-5678");
    expect(extractPhone("20260101")).toBeNull();
    expect(extractPhone(undefined)).toBeNull();
  });
});
