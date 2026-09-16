import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseArgs,
  renderViewportReport,
  summarizeViewportRuns,
} from "./cloud-viewport-matrix.mjs";

describe("cloud viewport matrix", () => {
  it("keeps hard-limit and viewport defaults reproducible", () => {
    const options = parseArgs([]);
    assert.equal(options.image, "hiremeops-cloud-worker:quality");
    assert.equal(options.memory, "512m");
    assert.equal(options.cpus, "0.2");
    assert.deepEqual(options.viewports, ["1024x768", "900x675", "800x600"]);
  });

  it("selects smallest valid viewport without hiding failures", () => {
    const options = { viewports: ["1024x768", "900x675", "800x600"] };
    const rows = [
      { platform: "linkedin", viewport: "1024x768", exitCode: 0, selectorsWorked: true, count: 2 },
      { platform: "linkedin", viewport: "900x675", exitCode: 0, selectorsWorked: true, count: 2 },
      {
        platform: "linkedin",
        viewport: "800x600",
        exitCode: 1,
        selectorsWorked: false,
        timeout: true,
        count: 0,
      },
    ];
    const summary = summarizeViewportRuns(rows, options);
    assert.equal(summary.smallestValidViewport, "900x675");
    assert.equal(summary.smallestValidByPlatform.linkedin, "900x675");
    assert.equal(summary.failed, 1);
  });

  it("renders human-readable matrix with resource metrics", () => {
    const report = {
      options: {
        image: "fixture",
        memory: "512m",
        cpus: "0.2",
        shmSize: "64m",
        viewports: ["1024x768"],
      },
      runs: [
        {
          platform: "linkedin",
          viewport: "1024x768",
          exitCode: 0,
          selectorsWorked: true,
          count: 1,
          durationMs: 10,
          cgroupPeakMb: 120,
        },
      ],
      summary: {
        platforms: ["linkedin"],
        smallestValidByPlatform: { linkedin: "1024x768" },
        smallestValidViewport: "1024x768",
        valid: 1,
        total: 1,
        timeout: 0,
        oom: 0,
      },
    };
    const markdown = renderViewportReport(report);
    assert.match(markdown, /LinkedIn|linkedin/);
    assert.match(markdown, /120 MB/);
    assert.match(markdown, /Smallest valid viewport globally/);
  });
});
