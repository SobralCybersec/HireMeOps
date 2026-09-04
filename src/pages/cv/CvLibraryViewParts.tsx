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
} from "../../components/ui";
import { CoverLetterExportButton, CvCard, CvExportButton, defaultCvBytesLoader } from "../cv";
import type { CvLibraryViewModel } from "../CvLibrary";
import type { CvRewriteReport, CvRewriteSummary } from "./types";

const loader = defaultCvBytesLoader;

export function CvLibraryToolbar({ model }: { model: CvLibraryViewModel }) {
  const {
    importing,
    isRewriting,
    firstCvOpen,
    setFirstCvOpen,
    query,
    setQuery,
    language,
    setLanguage,
    isAnalyzing,
    handleUpload,
  } = model;
  return (
    <Toolbar>
      <Button variant="primary" disabled={importing} onClick={() => handleUpload("pdf")}>
        {importing ? "Uploading..." : "Upload PDF"}
      </Button>
      <Button disabled={importing} onClick={() => handleUpload("docx")}>
        Upload DOCX
      </Button>
      <Button disabled>Import Profile</Button>
      <Button
        disabled={isRewriting}
        variant={firstCvOpen ? "primary" : "ghost"}
        onClick={() => setFirstCvOpen((open) => !open)}
      >
        First CV
      </Button>
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
      <CvLibrarySelectionToolbar model={model} />
    </Toolbar>
  );
}

function CvLibrarySelectionToolbar({ model }: { model: CvLibraryViewModel }) {
  const { selected, setOpenId, isAnalyzing, handleAnalyze, isDeleting, handleDelete } = model;
  if (selected === null) return null;
  return (
    <>
      <ToolbarSep />
      <Button size="sm" onClick={() => setOpenId(selected.id)}>
        View
      </Button>
      <Button size="sm" disabled>
        Re-parse
      </Button>
      <Button size="sm" disabled={isAnalyzing} onClick={handleAnalyze}>
        {isAnalyzing ? "Analysing..." : "Analyze again"}
      </Button>
      <Button size="sm" variant="danger" disabled={isDeleting} onClick={() => void handleDelete()}>
        {isDeleting ? "Deleting…" : "Delete"}
      </Button>
    </>
  );
}

function CvLibraryWarning({
  detail,
  message,
  onDismiss,
  label,
}: {
  detail: string;
  message: string;
  onDismiss: () => void;
  label: string;
}) {
  return (
    <div className="inline-warning inline-warning--danger" role="alert">
      <div className="inline-warning__body">
        <div>{message}</div>
        <div className="inline-warning__url">{detail}</div>
      </div>
      <button
        type="button"
        className="inline-warning__dismiss"
        onClick={onDismiss}
        aria-label={`Dismiss ${label} error`}
      >
        <Icon icon={Cancel01Icon} size={14} />
      </button>
    </div>
  );
}

export function CvLibraryAlerts({ model }: { model: CvLibraryViewModel }) {
  const {
    importError,
    setImportError,
    analyzeError,
    setAnalyzeError,
    rewriteError,
    setRewriteError,
    deleteError,
    setDeleteError,
  } = model;
  return (
    <>
      {importError !== null && (
        <CvLibraryWarning
          detail={importError}
          message="Upload failed. Your library is unchanged."
          onDismiss={() => setImportError(null)}
          label="upload"
        />
      )}
      {analyzeError !== null && (
        <CvLibraryWarning
          detail={analyzeError}
          message="Analyze again failed. Your library is unchanged."
          onDismiss={() => setAnalyzeError(null)}
          label="analyse"
        />
      )}
      {rewriteError !== null && (
        <CvLibraryWarning
          detail={rewriteError}
          message="Rewrite failed. Your library is unchanged."
          onDismiss={() => setRewriteError(null)}
          label="rewrite"
        />
      )}
      {deleteError !== null && (
        <CvLibraryWarning
          detail={deleteError}
          message="Delete failed. The file is still in your library."
          onDismiss={() => setDeleteError(null)}
          label="delete"
        />
      )}
    </>
  );
}

export function CvLibraryDocuments({ model }: { model: CvLibraryViewModel }) {
  const {
    loading,
    error,
    visible,
    query,
    importing,
    selectedId,
    selected,
    setReloadNonce,
    handleUpload,
    toggle,
    setOpenId,
  } = model;
  return loading ? (
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
      <CvLibraryInspector model={model} />
    </div>
  );
}

function CvLibraryInspector({ model }: { model: CvLibraryViewModel }) {
  const {
    selected,
    setOpenId,
    setSelectedId,
    latestRewrite,
    latestDetail,
    rewriteDetailLoading,
    loadRewriteDetail,
    setComparing,
  } = model;
  if (selected === null) return null;
  return (
    <div className="cvx-library-inspector">
      <Card
        title={selected.fileName}
        actions={
          <div className="cvx-inspector__actions">
            <Button size="sm" onClick={() => setOpenId(selected.id)}>
              Open
            </Button>
            <Button size="sm" aria-label="Close inspector" onClick={() => setSelectedId(null)}>
              <Icon icon={Cancel01Icon} size={14} />
            </Button>
          </div>
        }
      >
        <CvInspectorMetadata selected={selected} rows={model.inspectorRows} />
        <CvInspectorAnalysis model={model} />

        {/* AI rewrite -> PDF export. Only shown once a rewrite exists
                    for this document; produced via the CV analysis "Rewrite
                    with AI" action above. Export offers New (fresh render) or
                    Modify (stamp metadata onto the source PDF). */}
        <CvRewriteActions
          rewrite={latestRewrite}
          detail={latestDetail}
          loadingId={rewriteDetailLoading}
          onLoad={loadRewriteDetail}
          onCompare={setComparing}
        />
      </Card>
    </div>
  );
}

function CvInspectorMetadata({
  selected,
  rows,
}: {
  selected: NonNullable<CvLibraryViewModel["selected"]>;
  rows: CvLibraryViewModel["inspectorRows"];
}) {
  return (
    <>
      <dl className="cvx-inspector__list">
        {rows.map(({ label, value }) => (
          <div key={label} className="cvx-inspector__row">
            <dt>{label}</dt>
            <dd title={value}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="cvx-inspector__variants">
        <span className="cvx-inspector__heading">Assigned variants</span>
        <div className="cvx-variants">
          {selected.assignedVariants.length > 0 ? (
            selected.assignedVariants.map((variant) => (
              <span key={variant.id} className="tag">
                {variant.name}
              </span>
            ))
          ) : (
            <Badge variant="neutral">none</Badge>
          )}
        </div>
      </div>
    </>
  );
}

function CvInspectorAnalysis({ model }: { model: CvLibraryViewModel }) {
  const { selected, isRewriting, handleRewrite, extraInfo, setExtraInfo } = model;
  if (selected === null) return null;
  return (
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
          {isRewriting ? "Generating CV + letter..." : "Rewrite with AI"}
        </Button>
      </div>
      <label className="cvx-inspector__extra">
        <span className="cvx-inspector__extra-label">Extra info for AI / first CV</span>
        <Textarea
          rows={3}
          placeholder="For a first CV, include: name/contact, target role, education, projects, work/volunteer/freelance experience, skills/tools, languages, courses/certs, links, achievements/metrics, availability, notes…"
          value={extraInfo}
          onChange={(event) => setExtraInfo(event.target.value)}
          disabled={isRewriting}
          style={{ resize: "vertical", fontSize: "var(--text-xs)" }}
        />
      </label>
    </div>
  );
}

function CvRewriteActions({
  rewrite,
  detail,
  loadingId,
  onLoad,
  onCompare,
}: {
  rewrite: CvRewriteSummary | null;
  detail: CvRewriteReport | null;
  loadingId: string | null;
  onLoad: (id: string) => Promise<void>;
  onCompare: (report: CvRewriteReport) => void;
}) {
  if (rewrite === null) return null;
  return (
    <div className="cvx-inspector__rewrite">
      <span className="cvx-inspector__heading">AI rewrite</span>
      <div className="cvx-inspector__rewrite-actions">
        {detail ? (
          <>
            <CvExportButton rewrite={detail} />
            <CoverLetterExportButton rewrite={detail} />
            {detail.sourceText ? (
              <Button size="sm" onClick={() => onCompare(detail)}>
                Compare before / after
              </Button>
            ) : null}
          </>
        ) : (
          <Button size="sm" onClick={() => void onLoad(rewrite.id)}>
            {loadingId === rewrite.id ? "Loading rewrite..." : "Load rewrite details"}
          </Button>
        )}
      </div>
    </div>
  );
}
