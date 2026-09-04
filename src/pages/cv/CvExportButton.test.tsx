// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CvExportButton } from "./CvExportButton";
import { invokeStrict } from "../../lib/tauriInvoke";
import type { CvRewriteReport } from "./types";

vi.mock("../../lib/tauriInvoke", () => ({
  invokeStrict: vi.fn(),
  errMessage: (e: unknown): string => (e instanceof Error ? e.message : String(e)),
}));

const mockInvokeStrict = vi.mocked(invokeStrict);

const REWRITE: CvRewriteReport = {
  id: "rewrite-1",
  cvDocumentId: "source-1",
  cvFileName: "source.pdf",
  roleVariantId: null,
  variantName: null,
  modelProvider: "provider",
  modelName: "model",
  rewrite: {
    name: "Candidate",
    positions: ["Backend Engineer"],
    summary: "Summary",
    skills: [],
    experience: [],
    education: [],
    certificates: [
      {
        name: "Cloud Certificate",
        issuer: "Issuer",
        credentialId: "CERT-1",
        date: "2025",
        credentialUrl: "https://example.test/cert",
      },
    ],
    coverLetter: "",
  },
  metadata: {
    title: "Backend Engineer",
    subject: "Backend Engineer",
    keywords: "",
    author: "Candidate",
    description: "",
    category: "CV",
  },
  createdAt: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockInvokeStrict.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("CvExportButton", () => {
  it("defaults to rendering rewritten content when source PDF exists", async () => {
    render(<CvExportButton rewrite={REWRITE} />);

    const mode = screen.getByRole("combobox", { name: "PDF export mode" }) as HTMLSelectElement;
    expect(mode.value).toBe("new");

    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));

    await waitFor(() => {
      expect(mockInvokeStrict).toHaveBeenLastCalledWith("save_cv_rewrite_pdf", {
        rewriteId: "rewrite-1",
        mode: "new",
        suggestedName: "Candidate-CV.pdf",
      });
    });
  });
});
