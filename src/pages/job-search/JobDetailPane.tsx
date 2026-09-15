import type { JobMatchDto, JobPostDto } from "../../types/domain";
import { safeInvoke, errMessage } from "../../lib/tauriInvoke";
import { extractAssunto, extractPhone } from "../JobSearch.helpers";
import {
  runGmailApply,
  cathoApply,
  infojobsApply,
  startIndeedApply,
  confirmIndeedSubmit,
  rejectIndeedSubmit,
} from "../../stores/useJobStore";
import { useAutomationStore } from "../../stores/useAutomationStore";
import {
  Badge,
  Button,
  EmptyState,
  MatchScoreBadge,
  ScoreBar,
  Toolbar,
  matchScoreVariant,
  humanizeStatus,
  jobStatusVariant,
} from "../../components/ui";

/* ── Detail field sub-component ─────────────────────────────────── */

function DetailField({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: "var(--text-2xs)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--color-text-muted)",
          fontWeight: "var(--fw-semibold)",
        }}
      >
        {label}
      </div>
      {children ?? (
        <div
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--color-text-2)",
            fontFamily: "var(--font-mono)",
            marginTop: "2px",
          }}
        >
          {value}
        </div>
      )}
    </div>
  );
}

export type JobDetailModel = {
  mobilePane: "filters" | "jobs" | "detail";
  selected: JobPostDto | null;
  selectedMatchScore: number | null;
  selectedMatch: JobMatchDto | null;
  selectedMatchId: string | null;
  activeProfileId: string | null;
  isLoading: boolean;
  isApplying: boolean;
  indeedParked: boolean;
  linkedinParked: boolean;
  setIsApplying: (value: boolean) => void;
  setSearchMsg: (message: string | null) => void;
  setIndeedParked: (value: boolean) => void;
  setLinkedinParked: (value: boolean) => void;
  setDraftModalOpen: (value: boolean) => void;
  handleQueueDetail: () => Promise<void>;
  handleOpenSelected: () => Promise<void>;
  handleApplyLinkedIn: () => Promise<void>;
  handleSkipSelected: () => Promise<void>;
  loadJobs: (profileId: string) => Promise<void>;
};

export function JobDetailPane({ model }: { model: JobDetailModel }) {
  const { mobilePane, selected } = model;
  return (
    <div
      className="three-pane__panel job-search__detail"
      data-mobile-active={mobilePane === "detail"}
    >
      <div className="panel-header job-search__panel-header">
        <h2 className="panel-header__title">Detail</h2>
      </div>
      {selected === null ? (
        <EmptyState
          label="Select"
          title="No job selected"
          body="Click a job from the list to see details and match explanation."
        />
      ) : (
        <div className="job-search__detail-content">
          <JobDetailSummary model={model} />
          <JobDetailActions model={model} />
        </div>
      )}
    </div>
  );
}

function JobDetailSummary({ model }: { model: JobDetailModel }) {
  if (model.selected === null) return null;
  return (
    <>
      <JobDetailOverview model={model} />
      <JobScoreBreakdown model={model} />
      <JobDescription model={model} />
      <ContactEmail model={model} />
      <ContactPhone model={model} />
    </>
  );
}

function JobDetailOverview({ model }: { model: JobDetailModel }) {
  const { selected, selectedMatchScore } = model;
  if (selected === null) return null;
  return (
    <>
      <div>
        <h3
          style={{
            margin: 0,
            fontSize: "var(--text-md)",
            fontWeight: "var(--fw-semibold)",
            color: "var(--color-text)",
          }}
        >
          {selected.title}
        </h3>
        <div className="list-item__meta" style={{ marginTop: "var(--sp-1)" }}>
          {selected.company}
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: "var(--sp-3)",
        }}
      >
        <DetailField label="Location" value={selected.location ?? "Remote"} />
        <DetailField label="Platform" value={selected.platform} />
        <DetailField label="Status">
          <Badge variant={jobStatusVariant(selected.status)}>
            {humanizeStatus(selected.status)}
          </Badge>
        </DetailField>
        <DetailField label="Match">
          <MatchScoreBadge score={selectedMatchScore} />
        </DetailField>
      </div>
    </>
  );
}

function JobScoreBreakdown({ model }: { model: JobDetailModel }) {
  const match = model.selectedMatch;
  if (match === null) return null;
  const scores = [
    ["Overall", match.score],
    ["Role", match.roleScore],
    ["Skills", match.skillScore],
    ["Seniority", match.seniorityScore],
    ["Location", match.locationScore],
    ["Salary", match.salaryScore],
  ] as const;
  return (
    <div>
      <h4 className="section-title" style={{ marginBottom: "var(--sp-2)" }}>
        Score Breakdown
      </h4>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
        {scores.map(([label, value]) => (
          <ScoreBar key={label} label={label} value={value} variant={matchScoreVariant(value)} />
        ))}
      </div>
    </div>
  );
}

function JobDescription({ model }: { model: JobDetailModel }) {
  const description = model.selected?.description;
  if (description == null || description === "") return null;
  return (
    <div>
      <h4 className="section-title" style={{ marginBottom: "var(--sp-2)" }}>
        Description
      </h4>
      <div
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--color-text-2)",
          whiteSpace: "pre-wrap",
          overflowY: "auto",
          maxHeight: "220px",
          lineHeight: "1.55",
        }}
      >
        {description}
      </div>
    </div>
  );
}

async function sendEmailWithCv(options: {
  profileId: string;
  email: string;
  subject: string;
  body: string;
  setApplying: (value: boolean) => void;
  setMessage: (message: string | null) => void;
}) {
  const { profileId, email, subject, body, setApplying, setMessage } = options;
  setApplying(true);
  try {
    const docs = await safeInvoke<{ id: string }[]>("list_cv_documents", { profileId });
    const picked = localStorage.getItem("hiremeops-selected-cv");
    const cvId =
      picked && docs?.some((doc) => doc.id === picked) ? picked : (docs?.[0]?.id ?? null);
    await runGmailApply(profileId, email, subject, body, cvId);
    setMessage(
      cvId === null
        ? `Application sent to ${email}. No CV attached. Upload one in CV Library.`
        : `Application sent to ${email}`,
    );
  } catch (error) {
    setMessage(errMessage(error));
  } finally {
    setApplying(false);
  }
}

function ContactEmail({ model }: { model: JobDetailModel }) {
  const { selected, activeProfileId, isApplying, setIsApplying, setSearchMsg } = model;
  const email = selected?.contactEmail;
  if (selected === null || email == null) return null;
  const subject =
    extractAssunto(selected.description) ??
    (selected.title ? `Candidatura - ${selected.title}` : "Candidatura");
  const body = "Olá,\n\nTenho interesse na vaga. Segue meu currículo em anexo.\n\nAtenciosamente,";
  const href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const sendEmail = () => {
    if (activeProfileId === null || !window.confirm(`Send your CV to ${email} via Gmail?`)) return;
    void sendEmailWithCv({
      profileId: activeProfileId,
      email,
      subject,
      body,
      setApplying: setIsApplying,
      setMessage: setSearchMsg,
    });
  };
  return (
    <DetailField label="Contact email">
      <a
        href={href}
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--color-accent)",
          fontFamily: "var(--font-mono)",
          marginTop: "2px",
          display: "block",
          fontWeight: "var(--fw-semibold)",
        }}
      >
        Send CV by email
      </a>
      <span
        style={{
          fontSize: "var(--text-xs)",
          color: "var(--color-text-muted)",
          fontFamily: "var(--font-mono)",
          display: "block",
        }}
      >
        {email}
      </span>
      <span
        style={{
          fontSize: "var(--text-2xs)",
          color: "var(--color-text-muted)",
          display: "block",
          marginTop: "var(--sp-1)",
        }}
      >
        Attach your CV in your mail app before sending.
      </span>
      <Button
        size="sm"
        disabled={isApplying || activeProfileId === null}
        onClick={() => void sendEmail()}
      >
        {isApplying ? "Sending…" : "Auto-apply via Gmail"}
      </Button>
    </DetailField>
  );
}

function ContactPhone({ model }: { model: JobDetailModel }) {
  const phone = extractPhone(model.selected?.description);
  if (phone === null) return null;
  const digits = phone.replace(/\D/g, "");
  return (
    <DetailField label="Contact phone">
      <a
        href={`https://wa.me/55${digits}`}
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--color-accent)",
          fontFamily: "var(--font-mono)",
          fontWeight: "var(--fw-semibold)",
          display: "block",
          marginTop: "2px",
        }}
      >
        {phone}
      </a>
      <span
        style={{ fontSize: "var(--text-2xs)", color: "var(--color-text-muted)", display: "block" }}
      >
        Opens WhatsApp (assumes BR +55).
      </span>
    </DetailField>
  );
}

function JobDetailActions({ model }: { model: JobDetailModel }) {
  const {
    selected,
    selectedMatchId,
    isLoading,
    setDraftModalOpen,
    handleQueueDetail,
    handleOpenSelected,
    handleSkipSelected,
  } = model;
  if (selected === null) return null;
  return (
    <Toolbar>
      <Button variant="primary" size="sm" disabled={isLoading} onClick={handleQueueDetail}>
        Queue
      </Button>
      <Button
        size="sm"
        disabled={selectedMatchId === null}
        title={
          selectedMatchId === null
            ? "Score this job first to draft an application"
            : "Draft an application for this match"
        }
        onClick={() => setDraftModalOpen(true)}
      >
        Draft
      </Button>
      <Button size="sm" onClick={() => void handleOpenSelected()}>
        Open URL
      </Button>
      <CathoAction model={model} />
      <InfoJobsAction model={model} />
      <IndeedAction model={model} />
      <LinkedInAction model={model} />
      <Button size="sm" onClick={() => void handleSkipSelected()}>
        Skip
      </Button>
    </Toolbar>
  );
}

function CathoAction({ model }: { model: JobDetailModel }) {
  const { selected, activeProfileId, isApplying, setIsApplying, setSearchMsg } = model;
  if (selected === null || selected.platform !== "catho") return null;
  return (
    <Button
      size="sm"
      variant="primary"
      disabled={isApplying || activeProfileId === null}
      title="Submits your CV to this Catho offer in a visible window"
      onClick={() => {
        if (activeProfileId === null) return;
        if (!window.confirm(`Apply to "${selected.title}" on Catho? This sends your CV.`)) return;
        void (async () => {
          setIsApplying(true);
          try {
            const res = await cathoApply(activeProfileId, selected.id, selected.url);
            setSearchMsg(
              res.status === "applied"
                ? `Applied to "${selected.title}" on Catho.`
                : res.status === "submitted"
                  ? `Submitted to "${selected.title}" (confirm in the window).`
                  : `Catho apply: ${res.status}${res.reason ? ` (${res.reason})` : ""}`,
            );
          } catch (e) {
            setSearchMsg(errMessage(e));
          } finally {
            setIsApplying(false);
          }
        })();
      }}
    >
      {isApplying ? "Applying…" : "Apply on Catho"}
    </Button>
  );
}

function InfoJobsAction({ model }: { model: JobDetailModel }) {
  const { selected, activeProfileId, isApplying, setIsApplying, setSearchMsg } = model;
  if (selected === null || selected.platform !== "infojobs") return null;
  return (
    <Button
      size="sm"
      variant="primary"
      disabled={isApplying || activeProfileId === null}
      title="Clicks CANDIDATAR-ME on this InfoJobs offer in a visible window"
      onClick={() => {
        if (activeProfileId === null) return;
        if (
          !window.confirm(`Apply to "${selected.title}" on InfoJobs? This submits your candidacy.`)
        )
          return;
        void (async () => {
          setIsApplying(true);
          try {
            const res = await infojobsApply(activeProfileId, selected.id, selected.url);
            setSearchMsg(
              res.status === "applied"
                ? `Applied to "${selected.title}" on InfoJobs.`
                : res.status === "already_applied"
                  ? `Already applied to "${selected.title}".`
                  : res.status === "submitted"
                    ? `Submitted "${selected.title}" (finish in the window if it asks questions).`
                    : `InfoJobs apply: ${res.status}${res.reason ? ` (${res.reason})` : ""}`,
            );
          } catch (e) {
            setSearchMsg(errMessage(e));
          } finally {
            setIsApplying(false);
          }
        })();
      }}
    >
      {isApplying ? "Applying…" : "Apply on InfoJobs"}
    </Button>
  );
}

function IndeedAction({ model }: { model: JobDetailModel }) {
  const { selected, indeedParked } = model;
  if (selected === null || selected.platform !== "indeed") return null;
  return indeedParked ? <IndeedParkedActions model={model} /> : <IndeedPrepare model={model} />;
}

function IndeedParkedActions({ model }: { model: JobDetailModel }) {
  const { selected, isApplying, setIsApplying, setSearchMsg, setIndeedParked } = model;
  if (selected === null) return null;
  return (
    <>
      <Button
        size="sm"
        variant="primary"
        disabled={isApplying}
        title="Submits the reviewed SmartApply form to Indeed"
        onClick={() => {
          if (!window.confirm(`Submit your application to "${selected.title}" on Indeed?`)) return;
          void (async () => {
            setIsApplying(true);
            try {
              await confirmIndeedSubmit();
              setIndeedParked(false);
              setSearchMsg(`Submitted application to "${selected.title}" on Indeed.`);
            } catch (e) {
              setSearchMsg(errMessage(e));
            } finally {
              setIsApplying(false);
            }
          })();
        }}
      >
        {isApplying ? "Submitting…" : "Submit Indeed application"}
      </Button>
      <Button
        size="sm"
        disabled={isApplying}
        onClick={() => {
          void (async () => {
            setIsApplying(true);
            try {
              await rejectIndeedSubmit();
              setIndeedParked(false);
              setSearchMsg("Indeed application discarded.");
            } catch (e) {
              setSearchMsg(errMessage(e));
            } finally {
              setIsApplying(false);
            }
          })();
        }}
      >
        Discard
      </Button>
    </>
  );
}

function IndeedPrepare({ model }: { model: JobDetailModel }) {
  const { selected, activeProfileId, isApplying, setIsApplying, setSearchMsg, setIndeedParked } =
    model;
  if (selected === null) return null;
  return (
    <Button
      size="sm"
      variant="primary"
      disabled={isApplying || activeProfileId === null}
      title="Fills the Indeed SmartApply form and parks it for review. It does not submit."
      onClick={() => {
        if (activeProfileId === null) return;
        void (async () => {
          setIsApplying(true);
          try {
            await startIndeedApply(selected.url, activeProfileId);
            setIndeedParked(true);
            setSearchMsg(
              `SmartApply form ready for "${selected.title}". Review it in the window, then submit or discard.`,
            );
          } catch (e) {
            setSearchMsg(errMessage(e));
          } finally {
            setIsApplying(false);
          }
        })();
      }}
    >
      {isApplying ? "Preparing…" : "Apply on Indeed"}
    </Button>
  );
}

function LinkedInAction({ model }: { model: JobDetailModel }) {
  const {
    selected,
    activeProfileId,
    isApplying,
    linkedinParked,
    setIsApplying,
    setSearchMsg,
    setLinkedinParked,
    loadJobs,
    handleApplyLinkedIn,
  } = model;
  if (selected === null || selected.platform !== "linkedin") return null;
  return (
    <>
      {linkedinParked ? (
        <>
          <Button
            size="sm"
            variant="primary"
            disabled={isApplying}
            title="Submits the reviewed Easy Apply form to LinkedIn"
            onClick={() => {
              if (!window.confirm(`Submit your application to "${selected.title}" on LinkedIn?`))
                return;
              void (async () => {
                setIsApplying(true);
                try {
                  await useAutomationStore.getState().confirmSubmit();
                  setLinkedinParked(false);
                  setSearchMsg(`Submitted application to "${selected.title}" on LinkedIn.`);
                  await loadJobs(activeProfileId as string);
                } catch (e) {
                  setSearchMsg(errMessage(e));
                } finally {
                  setIsApplying(false);
                }
              })();
            }}
          >
            {isApplying ? "Submitting…" : "Submit LinkedIn application"}
          </Button>
          <Button
            size="sm"
            disabled={isApplying}
            onClick={() => {
              void (async () => {
                setIsApplying(true);
                try {
                  await useAutomationStore.getState().rejectSubmit();
                  setLinkedinParked(false);
                  setSearchMsg("LinkedIn application discarded.");
                } catch (e) {
                  setSearchMsg(errMessage(e));
                } finally {
                  setIsApplying(false);
                }
              })();
            }}
          >
            Discard
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant="primary"
          disabled={isApplying || activeProfileId === null}
          title="Fills and answers the Easy Apply form, then parks it for review. It does not submit."
          onClick={() => void handleApplyLinkedIn()}
        >
          {isApplying ? "Preparing…" : "Apply on LinkedIn"}
        </Button>
      )}
    </>
  );
}
