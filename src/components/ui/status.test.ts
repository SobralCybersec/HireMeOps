import { describe, expect, it } from "vitest";
import {
  applicationStatusVariant,
  automationVariant,
  humanizeStatus,
  jobStatusVariant,
  matchScoreVariant,
} from "./status";

describe("status vocabulary", () => {
  it("maps automation states and defaults in-flight states to running", () => {
    expect(automationVariant("Queued")).toBe("queued");
    expect(automationVariant("RetryScheduled")).toBe("queued");
    expect(automationVariant("Completed")).toBe("success");
    expect(automationVariant("Failed")).toBe("failed");
    expect(automationVariant("NeedsReview")).toBe("review");
    expect(automationVariant("PausedForCaptcha")).toBe("review");
    expect(automationVariant("Stopped")).toBe("stopped");
    expect(automationVariant("PausedByUser")).toBe("paused");
    expect(automationVariant("SkippedDuplicateUrl")).toBe("neutral");
    expect(automationVariant("Searching")).toBe("running");
  });

  it("maps job and application statuses, including unknown runtime values", () => {
    expect(jobStatusVariant("discovered")).toBe("neutral");
    expect(jobStatusVariant("matched")).toBe("running");
    expect(jobStatusVariant("rejected")).toBe("stopped");
    expect(jobStatusVariant("queued")).toBe("queued");
    expect(jobStatusVariant("applied")).toBe("success");
    expect(jobStatusVariant("failed")).toBe("failed");
    expect(jobStatusVariant("needs_review")).toBe("review");
    expect(jobStatusVariant("saved")).toBe("neutral");
    expect(jobStatusVariant("ignored")).toBe("neutral");
    expect(jobStatusVariant("skipped_duplicate_url")).toBe("neutral");
    expect(jobStatusVariant("other" as never)).toBe("neutral");
    expect(applicationStatusVariant("queued")).toBe("queued");
    expect(applicationStatusVariant("needs_review")).toBe("review");
    expect(applicationStatusVariant("submitted")).toBe("success");
    expect(applicationStatusVariant("failed")).toBe("failed");
    expect(applicationStatusVariant("skipped_duplicate")).toBe("neutral");
    expect(applicationStatusVariant("other" as never)).toBe("neutral");
  });

  it("grades scores and humanizes compound labels", () => {
    expect(matchScoreVariant(80)).toBe("success");
    expect(matchScoreVariant(60)).toBe("running");
    expect(matchScoreVariant(40)).toBe("review");
    expect(matchScoreVariant(39)).toBe("failed");
    expect(humanizeStatus("PreparingBrowser")).toBe("Preparing Browser");
    expect(humanizeStatus("needs_review")).toBe("Needs Review");
    expect(humanizeStatus("  already--done  ")).toBe("Already Done");
  });
});
