import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { Badge, Button, Card, Icon, Input, Textarea } from "../components/ui";
import {
  CoverLetterExportButton,
  CvExportButton,
  CvViewer,
  defaultCvBytesLoader,
  renderInlineBold,
} from "./cv";
import type { CvLanguage, CvLibraryDoc, CvRewriteReport, CvRewriteSummary } from "./cv";
import { useCvLibraryController } from "./cv/useCvLibraryController";
import { CvLibraryAlerts, CvLibraryDocuments, CvLibraryToolbar } from "./cv/CvLibraryViewParts";
import "./cv/cv.css";

/*
 * Bytes seam: the viewer/thumbnails render against `defaultCvBytesLoader`, which
 * invokes the real `cv_read_bytes` command (off-Tauri it degrades to a mock /
 * skeleton). The document list comes from `loadCvLibrary` -> `list_cv_documents`.
 */
const loader = defaultCvBytesLoader;

export function CvLibrary() {
  const model = useCvLibraryController();
  return <CvLibraryView model={model} />;
}

export type CvLibraryViewModel = {
  docs: CvLibraryDoc[];
  query: string;
  setQuery: (value: string) => void;
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  selected: CvLibraryDoc | null;
  opened: CvLibraryDoc | null;
  visible: CvLibraryDoc[];
  inspectorRows: { label: string; value: string }[];
  importing: boolean;
  isRewriting: boolean;
  firstCvOpen: boolean;
  setFirstCvOpen: (value: boolean | ((value: boolean) => boolean)) => void;
  language: CvLanguage;
  setLanguage: (value: CvLanguage) => void;
  isAnalyzing: boolean;
  handleAnalyze: () => Promise<void>;
  isDeleting: boolean;
  handleDelete: () => Promise<void>;
  importError: string | null;
  setImportError: (value: string | null) => void;
  analyzeError: string | null;
  setAnalyzeError: (value: string | null) => void;
  rewriteError: string | null;
  setRewriteError: (value: string | null) => void;
  deleteError: string | null;
  setDeleteError: (value: string | null) => void;
  firstCvTarget: string;
  setFirstCvTarget: (value: string) => void;
  firstCvInfo: string;
  setFirstCvInfo: (value: string) => void;
  firstCvReady: boolean;
  handleFirstCvRewrite: () => Promise<void>;
  latestFirstTimeRewrite: CvRewriteSummary | null;
  latestFirstTimeDetail: CvRewriteReport | null;
  rewriteDetailLoading: string | null;
  loadRewriteDetail: (id: string) => Promise<void>;
  setComparing: (value: CvRewriteReport | null) => void;
  comparing: CvRewriteReport | null;
  setOpenId: (value: string | null) => void;
  handleRewrite: () => Promise<void>;
  extraInfo: string;
  setExtraInfo: (value: string) => void;
  latestRewrite: CvRewriteSummary | null;
  latestDetail: CvRewriteReport | null;
  activeProfileId: string | null;
  setReloadNonce: (update: (value: number) => number) => void;
  setSelectedId: (value: string | null) => void;
  toggle: (id: string) => void;
  handleUpload: (kind: "pdf" | "docx") => Promise<void>;
};

function CvLibraryView({ model }: { model: CvLibraryViewModel }) {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">CV Library</h1>
        <span className="page-subtitle">{model.docs.length} documents</span>
      </div>
      <CvLibraryToolbar model={model} />
      <CvLibraryAlerts model={model} />
      <FirstCvComposer model={model} />
      <CvLibraryDocuments model={model} />
      {model.opened !== null && (
        <CvViewer cv={model.opened} loader={loader} onClose={() => model.setOpenId(null)} />
      )}
      {model.comparing !== null && (
        <CvCompareModal report={model.comparing} onClose={() => model.setComparing(null)} />
      )}
    </div>
  );
}

function FirstCvComposer({ model }: { model: CvLibraryViewModel }) {
  const {
    docs,
    firstCvOpen,
    setFirstCvOpen,
    isRewriting,
    firstCvTarget,
    setFirstCvTarget,
    firstCvInfo,
    setFirstCvInfo,
    firstCvReady,
    activeProfileId,
    handleFirstCvRewrite,
  } = model;
  return (
    <>
      {(firstCvOpen || docs.length === 0) && (
        <Card
          title="Create first CV"
          actions={
            docs.length > 0 ? (
              <Button size="sm" onClick={() => setFirstCvOpen(false)}>
                Hide
              </Button>
            ) : null
          }
          className="cvx-first-cv"
        >
          <div className="cvx-first-cv__grid">
            <label className="cvx-inspector__extra">
              <span className="cvx-inspector__extra-label">Target role</span>
              <Input
                placeholder="Junior Backend Developer, Data Analyst Intern, UX Designer…"
                value={firstCvTarget}
                onChange={(e) => setFirstCvTarget(e.target.value)}
                disabled={isRewriting}
              />
            </label>
            <label className="cvx-inspector__extra cvx-first-cv__facts">
              <span className="cvx-inspector__extra-label">Candidate facts</span>
              <Textarea
                rows={7}
                placeholder="Paste everything the model should use: name/contact, city, target role, education, projects, work/volunteer/freelance experience, skills/tools, languages, courses/certs, links, achievements/metrics, availability, notes. Unknown fields stay blank."
                value={firstCvInfo}
                onChange={(e) => setFirstCvInfo(e.target.value)}
                disabled={isRewriting}
                style={{ resize: "vertical", fontSize: "var(--text-xs)" }}
              />
            </label>
            <div className="cvx-first-cv__side">
              <span className="cvx-inspector__heading">Required source facts</span>
              <ul className="cvx-first-cv__checklist">
                <li>Name + contact</li>
                <li>Target role</li>
                <li>Education + courses/certs</li>
                <li>Projects or experience</li>
                <li>Skills/tools + links</li>
              </ul>
              <Button
                variant="primary"
                disabled={isRewriting || !firstCvReady || activeProfileId === null}
                onClick={handleFirstCvRewrite}
              >
                {isRewriting ? "Creating CV + letter..." : "Create first CV with AI"}
              </Button>
              {!firstCvReady && (
                <p className="cvx-first-cv__hint">
                  Add a target role and at least 80 characters of candidate facts.
                </p>
              )}
              <FirstCvResult model={model} />
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

function FirstCvResult({ model }: { model: CvLibraryViewModel }) {
  const {
    latestFirstTimeRewrite,
    latestFirstTimeDetail,
    rewriteDetailLoading,
    loadRewriteDetail,
    setComparing,
  } = model;
  if (latestFirstTimeRewrite === null) return null;
  return (
    <div className="cvx-first-cv__result">
      <span className="cvx-inspector__heading">Latest first CV</span>
      <div className="cvx-inspector__rewrite-actions">
        {latestFirstTimeDetail ? (
          <>
            <CvExportButton rewrite={latestFirstTimeDetail} />
            <CoverLetterExportButton rewrite={latestFirstTimeDetail} />
            {latestFirstTimeDetail.sourceText ? (
              <Button size="sm" onClick={() => setComparing(latestFirstTimeDetail)}>
                Review generated CV
              </Button>
            ) : null}
          </>
        ) : (
          <Button size="sm" onClick={() => void loadRewriteDetail(latestFirstTimeRewrite.id)}>
            {rewriteDetailLoading === latestFirstTimeRewrite.id
              ? "Loading rewrite..."
              : "Load generated CV"}
          </Button>
        )}
      </div>
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
            {r.certificates?.length > 0 && (
              <div className="cvx-compare__block">
                <h4>Certificates</h4>
                <ul>
                  {r.certificates.map((certificate, i) => {
                    const label = certificate.name || certificate.credentialId || "Certificate";
                    const href = certificate.credentialUrl?.trim();
                    const content = /^https?:\/\//i.test(href || "") ? (
                      <a href={href} target="_blank" rel="noreferrer">
                        {label}
                      </a>
                    ) : (
                      label
                    );
                    return (
                      <li key={i}>
                        {content}
                        {[certificate.issuer, certificate.date].filter(Boolean).join(" · ") && (
                          <span className="cvx-compare__meta">
                            {[certificate.issuer, certificate.date].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {r.coverLetter?.trim() && (
              <div className="cvx-compare__block">
                <h4>Cover letter</h4>
                <p className="cvx-cover-letter-preview">{r.coverLetter}</p>
                <CoverLetterExportButton rewrite={report} />
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
