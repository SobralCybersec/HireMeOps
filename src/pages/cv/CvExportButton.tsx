// Export control for a persisted CV rewrite: picks a render mode (fresh render
// vs. stamp-metadata-onto-source) and downloads the produced PDF. Self-contained
// so a rewrite result row/panel just drops in `<CvExportButton rewrite={r} />`.
//
// Pairs with `export_cv_rewrite({ rewriteId, mode })`. "Modify existing" is only
// offered when the source document still exists (`cvDocumentId != null`); the
// backend also falls back to a fresh render if the source is gone or not a PDF,
// so the choice is an optimisation, never a correctness requirement.

import { useState } from "react";
import { Download01Icon } from "@hugeicons/core-free-icons";
import { Button, Icon, Input, Select } from "../../components/ui";
import type { SelectOption } from "../../components/ui";
import { errMessage, invokeStrict } from "../../lib/tauriInvoke";
import { saveCvRewritePdf, type CvExportMode } from "./rewrite";
import type { CvRewriteReport } from "./types";

interface CvExportButtonProps {
  rewrite: CvRewriteReport;
  /** Extra classes for the wrapping control group. */
  className?: string;
}

const MODE_OPTIONS: SelectOption[] = [
  { value: "new", label: "New PDF (render)" },
  { value: "modify", label: "Modify source PDF" },
];

/** Filename for a rewrite's exported PDF: candidate name, else the source file. */
function exportFilename(rewrite: CvRewriteReport): string {
  const base =
    rewrite.rewrite.name.trim() ||
    rewrite.metadata.title.trim() ||
    rewrite.cvFileName.replace(/\.[^.]+$/, "") ||
    "cv";
  const slug = base.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-");
  return `${slug}-CV.pdf`;
}

export function CvExportButton({ rewrite, className }: CvExportButtonProps) {
  // Source present => default to reusing it; otherwise force a fresh render.
  const canModify = rewrite.cvDocumentId != null;
  const [mode, setMode] = useState<CvExportMode>(canModify ? "modify" : "new");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // CV-only appearance, seeded from the stored rewrite. Accent is a bare hex
  // (no `#`); the picker needs the `#` form, so we bridge on read/write.
  const [accent, setAccent] = useState(rewrite.rewrite.accentColor?.trim() || "2B0A3D");
  const [photoUrl, setPhotoUrl] = useState(rewrite.rewrite.photoUrl?.trim() || "");

  async function handleExport() {
    setBusy(true);
    setError(null);
    try {
      // Persist appearance first — export renders from the stored rewrite_json.
      await invokeStrict("set_cv_rewrite_appearance", {
        rewriteId: rewrite.id,
        accentColor: accent,
        photoUrl,
      });
      // Native save dialog + write in Rust; `null` means the user cancelled.
      await saveCvRewritePdf(rewrite.id, mode, exportFilename(rewrite));
    } catch (e) {
      setError(`Export failed: ${errMessage(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={["cv-export", className].filter(Boolean).join(" ")}>
      <div className="cv-export__appearance">
        <label className="cv-export__swatch" title="CV accent color">
          <Input
            type="color"
            aria-label="CV accent color"
            value={`#${accent}`}
            disabled={busy}
            onChange={(e) => setAccent(e.target.value.replace(/^#/, ""))}
          />
        </label>
        <Input
          type="url"
          inputMode="url"
          placeholder="Photo URL (https://…/photo.png)"
          aria-label="CV photo URL"
          value={photoUrl}
          disabled={busy}
          onChange={(e) => setPhotoUrl(e.target.value)}
        />
      </div>
      <div className="cv-export__row">
        {canModify ? (
          <Select
            aria-label="PDF export mode"
            value={mode}
            options={MODE_OPTIONS}
            disabled={busy}
            onChange={(e) => setMode(e.target.value as CvExportMode)}
          />
        ) : null}
        <Button
          variant="primary"
          size="sm"
          disabled={busy}
          onClick={handleExport}
          icon={<Icon icon={Download01Icon} size={12} />}
        >
          {busy ? "Exporting…" : "Export PDF"}
        </Button>
      </div>
      {error ? (
        <p className="cv-export__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
