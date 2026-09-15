// Tests freelas99-jobs.js: buildFreelas99SearchUrl query shape and page= param.
import { describe, it, expect } from "vitest";
import { buildFreelas99SearchUrl } from "./freelas99-jobs.js";

describe("buildFreelas99SearchUrl", () => {
  it("builds the documented query shape", () => {
    expect(buildFreelas99SearchUrl({ query: "desenvolvedor java" })).toBe(
      "https://www.99freelas.com.br/projects?q=desenvolvedor%20java",
    );
  });
  it("uses the `page` param (site ignores `pagina`), omitting page 1", () => {
    expect(buildFreelas99SearchUrl({ query: "java", page: 1 })).toBe(
      "https://www.99freelas.com.br/projects?q=java",
    );
    const p2 = buildFreelas99SearchUrl({ query: "java", page: 2 });
    expect(p2).toContain("page=2");
    expect(p2).not.toContain("pagina=2");
  });
});
