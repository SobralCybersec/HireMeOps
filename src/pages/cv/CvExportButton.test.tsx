// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CoverLetterExportButton, CvExportButton } from "./CvExportButton";
import { invokeStrict } from "../../lib/tauri/tauriInvoke";
import type { CvRewriteReport } from "./types";

vi.mock("../../lib/tauri/tauriInvoke", () => ({
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

  it("persists appearance, supports source mode and reports export errors", async () => {
    render(<CvExportButton rewrite={REWRITE} />);
    fireEvent.change(screen.getByRole("combobox", { name: "PDF export mode" }), {
      target: { value: "modify" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "CV photo URL" }), {
      target: { value: "https://example.test/photo.png" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
    await waitFor(() => {
      expect(mockInvokeStrict).toHaveBeenCalledWith("set_cv_rewrite_appearance", {
        rewriteId: "rewrite-1",
        accentColor: "2B0A3D",
        photoUrl: "https://example.test/photo.png",
      });
      expect(mockInvokeStrict).toHaveBeenCalledWith("save_cv_rewrite_pdf", {
        rewriteId: "rewrite-1",
        mode: "modify",
        suggestedName: "Candidate-CV.pdf",
      });
    });

    mockInvokeStrict.mockRejectedValueOnce(new Error("save failed"));
    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Export failed: save failed");
  });

  it("exports cover letters only when content exists and surfaces failures", async () => {
    const { rerender } = render(<CoverLetterExportButton rewrite={REWRITE} />);
    expect(screen.queryByRole("button", { name: "Export cover letter" })).toBeNull();
    const rewrite = { ...REWRITE, rewrite: { ...REWRITE.rewrite, coverLetter: "Dear team" } };
    rerender(<CoverLetterExportButton rewrite={rewrite} />);
    fireEvent.click(screen.getByRole("button", { name: "Export cover letter" }));
    await waitFor(() => {
      expect(mockInvokeStrict).toHaveBeenCalledWith("save_cover_letter_pdf", {
        rewriteId: "rewrite-1",
        suggestedName: "Candidate-Cover-Letter.pdf",
      });
    });
    mockInvokeStrict.mockRejectedValueOnce(new Error("letter failed"));
    fireEvent.click(screen.getByRole("button", { name: "Export cover letter" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Export failed: letter failed");
  });
});
