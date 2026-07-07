import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Toolbar,
  ToolbarSep,
  ToolbarSpacer,
  matchScoreVariant,
} from "../components/ui";
import {
  CvCard,
  CvViewer,
  MOCK_LIBRARY,
  defaultCvBytesLoader,
  formatBytes,
  relativeTime,
} from "./cv";
import "./cv/cv.css";

/*
 * Bytes seam: swap `defaultCvBytesLoader` for the real Tauri-backed loader once
 * the CV file backend lands. Nothing else on this page — or in the co-located
 * `cv/` module — changes when that happens.
 */
const loader = defaultCvBytesLoader;

export function CvLibrary() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const visible = MOCK_LIBRARY.filter((c) =>
    c.fileName.toLowerCase().includes(query.toLowerCase()),
  );

  const selected = MOCK_LIBRARY.find((c) => c.id === selectedId) ?? null;
  const opened = MOCK_LIBRARY.find((c) => c.id === openId) ?? null;

  function toggle(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">CV Library</h1>
        <span className="page-subtitle">{MOCK_LIBRARY.length} documents</span>
      </div>

      <Toolbar>
        <Button variant="primary" disabled>Upload PDF</Button>
        <Button disabled>Upload DOCX</Button>
        <Button disabled>Import Profile</Button>
        <ToolbarSep />
        <input
          type="search"
          className="field__input"
          placeholder="Search CVs…"
          aria-label="Search CVs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: 200 }}
        />
        <ToolbarSpacer />
        {selected !== null && (
          <>
            <Button size="sm" onClick={() => setOpenId(selected.id)}>View</Button>
            <Button size="sm" disabled>Re-parse</Button>
            <Button size="sm" disabled>Re-analyse</Button>
            <Button size="sm" variant="danger" disabled>Delete</Button>
          </>
        )}
      </Toolbar>

      {/* CV card grid ------------------------------------------------- */}
      {visible.length === 0 ? (
        <EmptyState
          label="Empty"
          title={query ? "No CVs match that search" : "No CVs uploaded yet"}
          body={
            query
              ? "Try a different filename."
              : "Upload a PDF or DOCX to get started. The system will parse and analyse it automatically."
          }
          action={
            !query && (
              <Button variant="primary" disabled>
                Upload your first CV
              </Button>
            )
          }
        />
      ) : (
        <div className="cv-grid">
          {visible.map((cv) => (
            <CvCard
              key={cv.id}
              cv={cv}
              loader={loader}
              selected={cv.id === selectedId}
              onSelect={toggle}
              onOpen={(id) => setOpenId(id)}
            />
          ))}
        </div>
      )}

      {/* Inspector ---------------------------------------------------- */}
      {selected !== null && (
        <Card
          title={`Inspector — ${selected.fileName}`}
          actions={
            <div style={{ display: "flex", gap: "var(--sp-2)" }}>
              <Button size="sm" onClick={() => setOpenId(selected.id)}>
                Open viewer
              </Button>
              <Button
                size="sm"
                aria-label="Close inspector"
                onClick={() => setSelectedId(null)}
              >
                ✕
              </Button>
            </div>
          }
        >
          <div className="form-grid">
            {(
              [
                { label: "File",       value: selected.fileName },
                { label: "Type",       value: selected.fileType.toUpperCase() },
                { label: "Pages",      value: String(selected.pageCount) },
                { label: "Size",       value: formatBytes(selected.sizeBytes) },
                { label: "Hash",       value: selected.fileHash },
                { label: "Profile ID", value: selected.profileId },
                { label: "Added",      value: relativeTime(selected.createdAt) },
                { label: "Last used",  value: relativeTime(selected.lastUsedAt) },
                { label: "Active",     value: selected.isActive ? "Yes" : "No" },
                {
                  label: "Last Score",
                  value:
                    selected.lastAnalysisScore !== null
                      ? `${selected.lastAnalysisScore}%`
                      : "–",
                },
              ] as const
            ).map(({ label, value }) => (
              <div key={label} className="field">
                <span className="field__label">{label}</span>
                <span className="field__value--mono">{value}</span>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: "var(--sp-4)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--sp-2)",
            }}
          >
            <span className="field__label">Assigned variants</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1)" }}>
              {selected.assignedVariants.length > 0 ? (
                selected.assignedVariants.map((v) => (
                  <span key={v.id} className="tag">
                    {v.name}
                  </span>
                ))
              ) : (
                <Badge variant="neutral">none</Badge>
              )}
              {selected.lastAnalysisScore !== null && (
                <Badge variant={matchScoreVariant(selected.lastAnalysisScore)}>
                  match {selected.lastAnalysisScore}%
                </Badge>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Full-document viewer ---------------------------------------- */}
      {opened !== null && (
        <CvViewer cv={opened} loader={loader} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}
