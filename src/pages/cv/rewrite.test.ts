import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  exportCoverLetter,
  exportCvRewrite,
  loadCvRewrite,
  loadCvRewrites,
  runCvRewrite,
  runFirstTimeCvRewrite,
  saveCoverLetterPdf,
  saveCvRewritePdf,
} from "./rewrite";
import { invokeStrict } from "../../lib/tauri/tauriInvoke";

vi.mock("../../lib/tauri/tauriInvoke", () => ({ invokeStrict: vi.fn() }));
const mockInvoke = vi.mocked(invokeStrict);

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue([]);
});

describe("CV rewrite command seam", () => {
  it("deduplicates concurrent list requests and clears cache after completion", async () => {
    let resolve!: (value: []) => void;
    mockInvoke.mockReturnValueOnce(new Promise((done) => (resolve = done)));
    const first = loadCvRewrites("profile-1");
    expect(loadCvRewrites("profile-1")).toBe(first);
    resolve([]);
    await first;
    expect(loadCvRewrites("profile-1")).not.toBe(first);
    expect(mockInvoke).toHaveBeenCalledWith("list_cv_rewrites", { profileId: "profile-1" });
  });

  it("forwards rewrite, first-time, load and export commands", async () => {
    mockInvoke.mockResolvedValueOnce([{ id: "r1" }]);
    await loadCvRewrite("p1", "r1");
    await runCvRewrite("doc-1", " Backend ", "en", "  links  ");
    await runFirstTimeCvRewrite("p1", " Backend ", "pt", " facts ");
    mockInvoke.mockResolvedValueOnce([65, 66]);
    expect(await exportCvRewrite("r1", "new")).toEqual(new Uint8Array([65, 66]));
    mockInvoke.mockResolvedValueOnce([67]);
    expect(await exportCoverLetter("r1")).toEqual(new Uint8Array([67]));
    await saveCvRewritePdf("r1", "modify", "candidate.pdf");
    await saveCoverLetterPdf("r1", "letter.pdf");
    expect(mockInvoke).toHaveBeenCalledWith("rewrite_cv_document", {
      cvDocumentId: "doc-1",
      targetTitle: " Backend ",
      language: "en",
      extraContext: "links",
    });
    expect(mockInvoke).toHaveBeenCalledWith("create_first_time_cv_rewrite", {
      profileId: "p1",
      targetTitle: "Backend",
      language: "pt",
      candidateContext: "facts",
    });
  });
});
