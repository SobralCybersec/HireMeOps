import { useEffect, useState } from "react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  Input,
  Textarea,
  Toolbar,
  ToolbarSep,
  ToolbarSpacer,
  matchScoreVariant,
} from "../components/ui";
import { open } from "@tauri-apps/plugin-dialog";
import {
  CvCard,
  CvViewer,
  CvExportButton,
  loadCvLibrary,
  importCvDocument,
  loadCvRewrites,
  runCvRewrite,
  renderInlineBold,
  defaultCvBytesLoader,
  formatBytes,
  relativeTime,
} from "./cv";
import type { CvLanguage, CvLibraryDoc, CvRewriteReport } from "./cv";
import { useSettingsStore } from "../stores/useSettingsStore";
import { errMessage, invokeStrict } from "../lib/tauriInvoke";
import "./cv/cv.css";

/*
 * Bytes seam: the viewer/thumbnails render against `defaultCvBytesLoader`, which
 * invokes the real `cv_read_bytes` command (off-Tauri it degrades to a mock /
 * skeleton). The document list comes from `loadCvLibrary` -> `list_cv_documents`.
 */
const loader = defaultCvBytesLoader;

export function CvLibrary() {
  const activeProfileId = useSettingsStore((s) => s.settings?.activeProfileId ?? null);
  const [docs, setDocs] = useState<CvLibraryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Bumped by the error-state Retry button to re-run the load effect even when
  // the profile id is unchanged (a plain re-set of the same value is a no-op).
  const [reloadNonce, setReloadNonce] = useState(0);
  // Upload flow: null when idle, a message string while importing/on failure.
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  // Re-analyse flow: mirrors the import error pattern.
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  // Delete flow
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // AI-rewrite flow: mirrors the analyse pattern. `rewrites` holds the profile's
  // persisted rewrites (newest first); the inspector surfaces the newest one for
  // the selected document so it can be exported to PDF.
  const [isRewriting, setIsRewriting] = useState(false);
  const [rewriteError, setRewriteError] = useState<string | null>(null);
  const [rewrites, setRewrites] = useState<CvRewriteReport[]>([]);
  // Output language for AI analysis/rewrite (pt-BR default, matching backend).
  const [language, setLanguage] = useState<CvLanguage>("pt");
  // Optional free-text context (links, GitHub, portfolio, notes) fed to the AI
  // for the next rewrite only. Empty = nothing sent.
  const [extraInfo, setExtraInfo] = useState("");
  // The rewrite currently shown in the before/after comparison overlay.
  const [comparing, setComparing] = useState<CvRewriteReport | null>(null);

  // Reset transient load state when the request identity changes. Done during
  // render (not synchronously inside the effect) so React folds it into the
  // in-progress render instead of triggering an extra commit->render cascade --
  // this is what satisfies react-hooks/set-state-in-effect. See react.dev
  // "you-might-not-need-an-effect" (resetting all state when a prop changes).
  const requestKey = `${activeProfileId ?? ""}:${reloadNonce}`;
  const [loadingKey, setLoadingKey] = useState(requestKey);
  if (loadingKey !== requestKey) {
    setLoadingKey(requestKey);
    setLoading(true);
    setError(null);
  }

  // Load the active profile's real CV documents. Passing "" when there is no
  // active profile yields an empty library from the backend (and, off-Tauri,
  // the dev mock returns rows regardless so previews stay populated). A backend
  // *error* sets `error` -- distinct from an empty `[]` -- so a failed load never
  // masquerades as "no CVs uploaded yet".
  useEffect(() => {
    let cancelled = false;
    loadCvLibrary(activeProfileId ?? "")
      .then((rows) => {
        if (cancelled) return;
        setDocs(rows);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setDocs([]);
        setError(errMessage(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProfileId, reloadNonce]);

  // Load the profile's persisted CV rewrites (newest first). Keyed on the same
  // deps as the library load so a fresh rewrite (which bumps `reloadNonce`)
  // reloads the list. A load failure degrades to an empty list -- the rewrite
  // affordance simply stays hidden rather than blocking the library view.
  useEffect(() => {
    let cancelled = false;
    loadCvRewrites(activeProfileId ?? "")
      .then((rows) => {
        if (!cancelled) setRewrites(rows);
      })
      .catch(() => {
        if (!cancelled) setRewrites([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProfileId, reloadNonce]);

  const visible = docs.filter((c) => c.fileName.toLowerCase().includes(query.toLowerCase()));

  const selected = docs.find((c) => c.id === selectedId) ?? null;
  const opened = docs.find((c) => c.id === openId) ?? null;

  function toggle(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  // Open a native file picker for the given type, import the chosen file into
  // the active profile, then reload the library. A backend DomainError (bad
  // file, parse failure, unsupported type) surfaces via `importError`; the user
  // cancelling the dialog is a no-op. Guarded so double-clicks can't overlap.
  async function handleUpload(kind: "pdf" | "docx") {
    if (importing) return;
    const selected = await open({
      multiple: false,
      directory: false,
      filters:
        kind === "pdf"
          ? [{ name: "PDF", extensions: ["pdf"] }]
          : [{ name: "Word document", extensions: ["docx"] }],
    });
    if (typeof selected !== "string") return; // cancelled
    setImporting(true);
    setImportError(null);
    try {
      await importCvDocument(activeProfileId ?? "", selected);
      setReloadNonce((n) => n + 1);
    } catch (e) {
      setImportError(errMessage(e));
    } finally {
      setImporting(false);
    }
  }

  async function handleAnalyze() {
    if (isAnalyzing || selected === null) return;
    setIsAnalyzing(true);
    setAnalyzeError(null);
    try {
      await invokeStrict<string>("analyze_cv_document", { cvDocumentId: selected.id, language });
      setReloadNonce((n) => n + 1);
    } catch (e) {
      setAnalyzeError(errMessage(e));
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleDelete() {
    if (isDeleting || selected === null) return;
    if (!window.confirm(`Delete "${selected.fileName}"? This cannot be undone.`)) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await invokeStrict<void>("delete_cv_document", { cvDocumentId: selected.id });
      setSelectedId(null);
      setReloadNonce((n) => n + 1);
    } catch (e) {
      setDeleteError(errMessage(e));
    } finally {
      setIsDeleting(false);
    }
  }

  // Produce an AI-tailored rewrite of the selected CV, then reload the rewrites
  // list (via `reloadNonce`) so the inspector's Export-PDF affordance appears.
  // Mirrors `handleAnalyze`'s busy/error conventions.
  async function handleRewrite() {
    if (isRewriting || selected === null) return;
    setIsRewriting(true);
    setRewriteError(null);
    try {
      await runCvRewrite(selected.id, undefined, language, extraInfo);
      setReloadNonce((n) => n + 1);
    } catch (e) {
      setRewriteError(errMessage(e));
    } finally {
      setIsRewriting(false);
    }
  }

  // Inspector metadata rows -- computed once when selected changes.
  const inspectorRows = selected
    ? [
        { label: "File", value: selected.fileName },
        { label: "Type", value: selected.fileType.toUpperCase() },
        { label: "Pages", value: String(selected.pageCount) },
        { label: "Size", value: formatBytes(selected.sizeBytes) },
        { label: "Hash", value: selected.fileHash },
        { label: "Profile ID", value: selected.profileId },
        { label: "Added", value: relativeTime(selected.createdAt) },
        { label: "Last used", value: relativeTime(selected.lastUsedAt) },
        { label: "Active", value: selected.isActive ? "Yes" : "No" },
        {
          label: "Last Score",
          value: selected.lastAnalysisScore !== null ? `${selected.lastAnalysisScore}%` : "-",
        },
      ]
    : [];

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">CV Library</h1>
        <span className="page-subtitle">{docs.length} documents</span>
      </div>

      <Toolbar>
        <Button variant="primary" disabled={importing} onClick={() => handleUpload("pdf")}>
          {importing ? "Uploading..." : "Upload PDF"}
        </Button>
        <Button disabled={importing} onClick={() => handleUpload("docx")}>
          Upload DOCX
        </Button>
        <Button disabled>Import Profile</Button>
        <ToolbarSep />
        <Input
          type="search"
          className="cvx-search"
          placeholder="Search CVs..."
          aria-label="Search CVs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ToolbarSpacer />
        {selected !== null && (
          <>
            <Button size="sm" onClick={() => setOpenId(selected.id)}>
              View
            </Button>
            <Button size="sm" disabled>
              Re-parse
            </Button>
            <ToolbarSep />
            <Button
              size="sm"
              variant={language === "pt" ? "primary" : "ghost"}
              disabled={isAnalyzing || isRewriting}
              onClick={() => setLanguage("pt")}
              title="Generate analysis & rewrites in Portuguese (pt-BR)"
            >
              PT
            </Button>
            <Button
              size="sm"
              variant={language === "en" ? "primary" : "ghost"}
              disabled={isAnalyzing || isRewriting}
              onClick={() => setLanguage("en")}
              title="Generate analysis & rewrites in English"
            >
              EN
            </Button>
            <ToolbarSep />
            <Button size="sm" disabled={isAnalyzing} onClick={handleAnalyze}>
              {isAnalyzing ? "Analysing..." : "Re-analyse"}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={isDeleting}
              onClick={() => void handleDelete()}
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </Button>
          </>
        )}
      </Toolbar>

      {importError !== null && (
        <div className="inline-warning inline-warning--danger" role="alert">
          <div className="inline-warning__body">
            <div>Upload failed. Your library is unchanged.</div>
            <div className="inline-warning__url">{importError}</div>
          </div>
          <button
            type="button"
            className="inline-warning__dismiss"
            onClick={() => setImportError(null)}
            aria-label="Dismiss upload error"
          >
            <Icon icon={Cancel01Icon} size={14} />
          </button>
        </div>
      )}

      {analyzeError !== null && (
        <div className="inline-warning inline-warning--danger" role="alert">
          <div className="inline-warning__body">
            <div>Re-analyse failed. Your library is unchanged.</div>
            <div className="inline-warning__url">{analyzeError}</div>
          </div>
          <button
            type="button"
            className="inline-warning__dismiss"
            onClick={() => setAnalyzeError(null)}
            aria-label="Dismiss analyse error"
          >
            <Icon icon={Cancel01Icon} size={14} />
          </button>
        </div>
      )}

      {rewriteError !== null && (
        <div className="inline-warning inline-warning--danger" role="alert">
          <div className="inline-warning__body">
            <div>Rewrite failed. Your library is unchanged.</div>
            <div className="inline-warning__url">{rewriteError}</div>
          </div>
          <button
            type="button"
            className="inline-warning__dismiss"
            onClick={() => setRewriteError(null)}
            aria-label="Dismiss rewrite error"
          >
            <Icon icon={Cancel01Icon} size={14} />
          </button>
        </div>
      )}

      {deleteError !== null && (
        <div className="inline-warning inline-warning--danger" role="alert">
          <div className="inline-warning__body">
            <div>Delete failed. The file is still in your library.</div>
            <div className="inline-warning__url">{deleteError}</div>
          </div>
          <button
            type="button"
            className="inline-warning__dismiss"
            onClick={() => setDeleteError(null)}
            aria-label="Dismiss delete error"
          >
            <Icon icon={Cancel01Icon} size={14} />
          </button>
        </div>
      )}

      {/* Content area: grid-only when nothing selected, grid + inspector
          side-by-side when a document is selected. The split gives the
          inspector spatial proximity to the grid instead of floating
          disconnected below it. */}
      {loading ? (
        <EmptyState
          label="..."
          title="Loading CVs..."
          body="Reading this profile's document library."
        />
      ) : error !== null ? (
        <EmptyState
          label="Error"
          title="Couldn't load your CV library"
          body={`The document store returned an error, so your CVs aren't shown. This does not mean they were deleted. ${error}`}
          action={
            <Button variant="primary" onClick={() => setReloadNonce((n) => n + 1)}>
              Retry
            </Button>
          }
        />
      ) : visible.length === 0 ? (
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
              <Button variant="primary" disabled={importing} onClick={() => handleUpload("pdf")}>
                {importing ? "Uploading..." : "Upload your first CV"}
              </Button>
            )
          }
        />
      ) : (
        <div className="cvx-library-split" data-inspector={selected !== null ? "1" : "0"}>
          {/* Card grid */}
          <div className="cvx-library-cards">
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
          </div>

          {/* Inspector panel -- only rendered when selected */}
          {selected !== null && (
            <div className="cvx-library-inspector">
              <Card
                title={selected.fileName}
                actions={
                  <div className="cvx-inspector__actions">
                    <Button size="sm" onClick={() => setOpenId(selected.id)}>
                      Open
                    </Button>
                    <Button
                      size="sm"
                      aria-label="Close inspector"
                      onClick={() => setSelectedId(null)}
                    >
                      <Icon icon={Cancel01Icon} size={14} />
                    </Button>
                  </div>
                }
              >
                {/* Metadata rows -- key/value pairs, mono values, truncated. */}
                <dl className="cvx-inspector__list">
                  {inspectorRows.map(({ label, value }) => (
                    <div key={label} className="cvx-inspector__row">
                      <dt>{label}</dt>
                      <dd title={value}>{value}</dd>
                    </div>
                  ))}
                </dl>

                {/* Assigned variants + score */}
                <div className="cvx-inspector__variants">
                  <span className="cvx-inspector__heading">Assigned variants</span>
                  <div className="cvx-variants">
                    {selected.assignedVariants.length > 0 ? (
                      selected.assignedVariants.map((v) => (
                        <span key={v.id} className="tag">
                          {v.name}
                        </span>
                      ))
                    ) : (
                      <Badge variant="neutral">none</Badge>
                    )}
                  </div>
                </div>

                {/* CV analysis + rewrite. The "Rewrite with AI" trigger sits
                    beside the analysis score so it reads as the natural next
                    step after seeing the match result. */}
                <div className="cvx-inspector__analysis">
                  <span className="cvx-inspector__heading">CV analysis</span>
                  <div className="cvx-inspector__analysis-row">
                    {selected.lastAnalysisScore !== null ? (
                      <Badge variant={matchScoreVariant(selected.lastAnalysisScore)}>
                        match {selected.lastAnalysisScore}%
                      </Badge>
                    ) : (
                      <Badge variant="neutral">not analysed</Badge>
                    )}
                    <Button
                      size="sm"
                      variant="primary"
                      aria-label="Rewrite this CV with AI"
                      disabled={isRewriting}
                      onClick={handleRewrite}
                    >
                      {isRewriting ? "Rewriting..." : "Rewrite with AI"}
                    </Button>
                  </div>
                  <label className="cvx-inspector__extra">
                    <span className="cvx-inspector__extra-label">
                      Extra info for the AI (optional)
                    </span>
                    <Textarea
                      rows={3}
                      placeholder="Links, GitHub, portfolio, sites, notes — anything you want the AI to weave in…"
                      value={extraInfo}
                      onChange={(e) => setExtraInfo(e.target.value)}
                      disabled={isRewriting}
                      style={{ resize: "vertical", fontSize: "var(--text-xs)" }}
                    />
                  </label>
                </div>

                {/* AI rewrite -> PDF export. Only shown once a rewrite exists
                    for this document; produced via the CV analysis "Rewrite
                    with AI" action above. Export offers New (fresh render) or
                    Modify (stamp metadata onto the source PDF). */}
                {(() => {
                  const latestRewrite = rewrites.find((r) => r.cvDocumentId === selected.id);
                  return latestRewrite ? (
                    <div className="cvx-inspector__rewrite">
                      <span className="cvx-inspector__heading">AI rewrite</span>
                      <div className="cvx-inspector__rewrite-actions">
                        <CvExportButton rewrite={latestRewrite} />
                        {latestRewrite.sourceText ? (
                          <Button size="sm" onClick={() => setComparing(latestRewrite)}>
                            Compare before / after
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : null;
                })()}
              </Card>
            </div>
          )}
        </div>
      )}

      {/* Full-document viewer */}
      {opened !== null && <CvViewer cv={opened} loader={loader} onClose={() => setOpenId(null)} />}

      {/* Before/after comparison overlay */}
      {comparing !== null && (
        <CvCompareModal report={comparing} onClose={() => setComparing(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Before/after comparison overlay. Left = the original extracted CV text the AI
// read (`sourceText`); right = the structured content it produced. Shows people
// exactly what the rewrite changed.
// ---------------------------------------------------------------------------
function CvCompareModal({ report, onClose }: { report: CvRewriteReport; onClose: () => void }) {
  const r = report.rewrite;
  return (
    <div className="cvx-compare" role="dialog" aria-modal="true" aria-label="CV before and after">
      <div className="cvx-compare__bar">
        <span className="cvx-compare__title">Before / after — {report.cvFileName}</span>
        <Button size="sm" aria-label="Close comparison" onClick={onClose}>
          <Icon icon={Cancel01Icon} size={14} />
        </Button>
      </div>
      <div className="cvx-compare__body">
        {/* Before */}
        <section className="cvx-compare__col">
          <header className="cvx-compare__col-head">
            <Badge variant="neutral">Before</Badge>
            <span>Original CV text</span>
          </header>
          <pre className="cvx-compare__source">
            {report.sourceText || "No original text stored."}
          </pre>
        </section>

        {/* After */}
        <section className="cvx-compare__col">
          <header className="cvx-compare__col-head">
            <Badge variant="success">After</Badge>
            <span>AI-rewritten content</span>
          </header>
          <div className="cvx-compare__after">
            {r.summary && (
              <div className="cvx-compare__block">
                <h4>Summary</h4>
                <p>{renderInlineBold(r.summary)}</p>
              </div>
            )}
            {r.skills.length > 0 && (
              <div className="cvx-compare__block">
                <h4>Skills</h4>
                <ul>
                  {r.skills.map((g, i) => (
                    <li key={i}>{g.category ? `${g.category}: ${g.skills}` : g.skills}</li>
                  ))}
                </ul>
              </div>
            )}
            {r.experience.length > 0 && (
              <div className="cvx-compare__block">
                <h4>Experience</h4>
                {r.experience.map((e, i) => (
                  <div key={i} className="cvx-compare__entry">
                    <strong>{e.title || "—"}</strong>
                    <span className="cvx-compare__meta">
                      {[e.organization, e.location, e.dates].filter(Boolean).join(" · ")}
                    </span>
                    {e.bullets.length > 0 && (
                      <ul>
                        {e.bullets.map((b, j) => (
                          <li key={j}>{renderInlineBold(b)}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
            {r.education.length > 0 && (
              <div className="cvx-compare__block">
                <h4>Education</h4>
                {r.education.map((e, i) => (
                  <div key={i} className="cvx-compare__entry">
                    <strong>{e.degree || "—"}</strong>
                    <span className="cvx-compare__meta">
                      {[e.institution, e.location, e.dates].filter(Boolean).join(" · ")}
                    </span>
                    {e.bullets.length > 0 && (
                      <ul>
                        {e.bullets.map((b, j) => (
                          <li key={j}>{renderInlineBold(b)}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
