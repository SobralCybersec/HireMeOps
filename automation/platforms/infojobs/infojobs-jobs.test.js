// Tests infojobs-jobs.js: infojobsWorkMode/infojobsAntiguedad facet mapping, buildInfojobsSearchUrl.
import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import {
  buildInfojobsSearchUrl,
  infojobsWorkMode,
  infojobsAntiguedad,
  extractInfojobsKillerQuestions,
} from "./infojobs-jobs.js";

// A page whose evaluate() just runs the callback against a jsdom document — lets us exercise
// the real killer-question parser without a browser.
function fakePage(html) {
  const dom = new JSDOM(html);
  return {
    evaluate: (fn, arg) => {
      const prev = globalThis.document;
      globalThis.document = dom.window.document;
      try {
        return Promise.resolve(fn(arg));
      } finally {
        globalThis.document = prev;
      }
    },
  };
}

// Mirrors the real InfoJobs killer-questions DOM: a `.t4.font-weight-bold` label followed by a
// `.mb-32` block holding either SIM/NÃO radios or an open-answer textarea.
const KILLER_FORM_HTML = `
<div id="KillerQuestionsForm">
  <div class="t4 mb-16 font-weight-bold">Possui Nível Superior em Ciências Contábeis?</div>
  <div class="mb-32">
    <div class="custom-control custom-radio">
      <input id="Answer_1" type="radio" value="SIM" name="ClosedQuestion_11720009">
      <label class="custom-control-label" for="Answer_1">SIM</label>
    </div>
    <div class="custom-control custom-radio">
      <input id="Answer_2" type="radio" value="NÃO" name="ClosedQuestion_11720009">
      <label class="custom-control-label" for="Answer_2">NÃO</label>
    </div>
  </div>
  <div class="t4 mb-16 font-weight-bold">Qual sua pretensão salarial para essa vaga?</div>
  <div class="mb-32">
    <textarea maxlength="2000" name="Item1[10].OpenAnswer"></textarea>
  </div>
</div>`;

describe("infojobsWorkMode", () => {
  it("maps remote/home-office to idw=2, hybrid to 3, onsite to 1", () => {
    expect(infojobsWorkMode(["remote"])).toBe(2);
    expect(infojobsWorkMode(["home office"])).toBe(2);
    expect(infojobsWorkMode(["hybrid"])).toBe(3);
    expect(infojobsWorkMode(["On-site"])).toBe(1);
    expect(infojobsWorkMode(["presencial"])).toBe(1);
  });
  it("prefers remote when several modes are present, null when none match", () => {
    expect(infojobsWorkMode(["hybrid", "remote"])).toBe(2);
    expect(infojobsWorkMode([])).toBeNull();
    expect(infojobsWorkMode(["flexible"])).toBeNull();
  });
});

describe("infojobsAntiguedad", () => {
  it("buckets a day window into InfoJobs' 1..5 codes", () => {
    expect(infojobsAntiguedad(1)).toBe(1);
    expect(infojobsAntiguedad(3)).toBe(2);
    expect(infojobsAntiguedad(7)).toBe(3);
    expect(infojobsAntiguedad(15)).toBe(4);
    expect(infojobsAntiguedad(30)).toBe(5);
  });
  it("returns null for absent/invalid windows", () => {
    expect(infojobsAntiguedad(null)).toBeNull();
    expect(infojobsAntiguedad("")).toBeNull();
    expect(infojobsAntiguedad(0)).toBeNull();
    expect(infojobsAntiguedad(-4)).toBeNull();
  });
});

describe("buildInfojobsSearchUrl", () => {
  it("builds a keyword-only nationwide search", () => {
    expect(buildInfojobsSearchUrl({ query: "desenvolvedor" })).toBe(
      "https://www.infojobs.com.br/empregos.aspx?palabra=desenvolvedor",
    );
  });
  it("adds poblacion, idw and Antiguedad when provided", () => {
    expect(
      buildInfojobsSearchUrl({
        query: "desenvolvedor",
        location: "5211323",
        workModels: ["remote"],
        lastDays: 3,
      }),
    ).toBe(
      "https://www.infojobs.com.br/empregos.aspx?palabra=desenvolvedor&poblacion=5211323&idw=2&Antiguedad=2",
    );
  });
  it("url-encodes the keyword and omits empty params", () => {
    expect(buildInfojobsSearchUrl({ query: "analista de dados" })).toBe(
      "https://www.infojobs.com.br/empregos.aspx?palabra=analista%20de%20dados",
    );
    expect(buildInfojobsSearchUrl({})).toBe("https://www.infojobs.com.br/empregos.aspx");
  });
});

describe("extractInfojobsKillerQuestions", () => {
  it("parses SIM/NÃO radios and open-answer textareas with their labels", async () => {
    const questions = await extractInfojobsKillerQuestions(fakePage(KILLER_FORM_HTML));
    expect(questions).toHaveLength(2);

    const radio = questions[0];
    expect(radio.kind).toBe("radio");
    expect(radio.label).toBe("Possui Nível Superior em Ciências Contábeis?");
    expect(radio.options.map((o) => o.value)).toEqual(["SIM", "NÃO"]);
    expect(radio.options[0].id).toBe("Answer_1");

    const text = questions[1];
    expect(text.kind).toBe("text");
    expect(text.label).toBe("Qual sua pretensão salarial para essa vaga?");
    expect(text.name).toBe("Item1[10].OpenAnswer");
    expect(text.maxLength).toBe(2000);
  });

  it("returns [] when there is no killer form (single-click apply)", async () => {
    const questions = await extractInfojobsKillerQuestions(fakePage("<div>no form here</div>"));
    expect(questions).toEqual([]);
  });
});
