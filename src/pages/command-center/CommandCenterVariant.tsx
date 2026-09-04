import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight02Icon,
  InboxIcon,
  Login03Icon,
  Mail01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { Button, Dropdown, Icon, Switch } from "../../components/ui";
import { VisitorsChart } from "../../components/ui/VisitorsChart";
import { PlatformHub } from "../../components/PlatformHub";
import type { CvDocument, JobPostDto, Profile, ProfileVariantDto } from "../../types/domain";

interface Tip {
  title: string;
  content: string;
  highlight?: string;
}

const TIPS: Tip[] = [
  {
    title: "One Login, Every Site",
    content:
      "Universal Login opens all five job sites in one window. Sign in once — the shared cookie jar remembers you everywhere.",
    highlight: "one window",
  },
  {
    title: "Read the Lights",
    content:
      "A green check means you're logged in; a red cross means that tab still wants your password. Hit Refresh to re-probe.",
    highlight: "green check",
  },
  {
    title: "Zero Copy-Paste",
    content:
      "The Fill buttons on Profile Variants auto-type your resume into Catho, Gupy and InfoJobs — you never touch a field.",
    highlight: "auto-type your resume",
  },
  {
    title: "Failures Explain Themselves",
    content:
      "Every run drops a screenshot, DOM and network bundle in automation/captures/. I read the real reason — you paste nothing.",
    highlight: "automation/captures/",
  },
  {
    title: "Preferences Have Teeth",
    content:
      "Excluded keywords and blocked companies hard-skip a listing before it's ever scored. They're filters, not decoration.",
    highlight: "hard-skip",
  },
  {
    title: "One Browser, One Jar",
    content:
      "InfoJobs, Catho, Gupy and LinkedIn all share the browser you logged into — no second window, no second password.",
    highlight: "share the browser",
  },
  {
    title: "Watch Once, Then Trust",
    content:
      "Run headed the first time on a new site. See it fill a form, then let it run quiet and headless.",
    highlight: "headed the first time",
  },
  {
    title: "Live Vagas",
    content:
      "Found jobs land in the Vagas panel the moment a search finishes — no refresh, no reload.",
    highlight: "the moment a search finishes",
  },
];

function renderTip(content: string, highlight?: string): ReactNode {
  if (!highlight) return content;
  const at = content.indexOf(highlight);
  if (at < 0) return content;
  return (
    <>
      {content.slice(0, at)}
      <span className="cc-dlg__hi">{highlight}</span>
      {content.slice(at + highlight.length)}
    </>
  );
}

function DialogueTips({ tips }: { tips: Tip[] }) {
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(true);
  const timers = useRef<number[]>([]);

  const advance = useCallback(() => {
    setShown(false);
    const id = window.setTimeout(() => {
      setIndex((cur) => {
        if (tips.length < 2) return cur;
        let next = cur;
        while (next === cur) next = Math.floor(Math.random() * tips.length);
        return next;
      });
      setShown(true);
    }, 340);
    timers.current.push(id);
  }, [tips.length]);

  useEffect(() => {
    const id = window.setInterval(advance, 9000);
    return () => {
      window.clearInterval(id);
      timers.current.forEach(window.clearTimeout);
      timers.current = [];
    };
  }, [advance]);

  const tip = tips[index];
  return (
    <div className="cc-dlg">
      <span className="cc-dlg__name">ENI</span>
      <div className={shown ? "cc-dlg__body is-shown" : "cc-dlg__body"} aria-live="polite">
        <h3 className="cc-dlg__title">{tip.title}</h3>
        <p className="cc-dlg__text">{renderTip(tip.content, tip.highlight)}</p>
      </div>
      <button type="button" className="cc-dlg__next" onClick={advance}>
        Next tip
        <Icon icon={ArrowRight02Icon} size={14} />
      </button>
      <span className="cc-dlg__triangle" aria-hidden="true" />
    </div>
  );
}

const COMMAND_CENTER_VARIANTS = [
  {
    id: "1",
    className: "focus",
    visible: true,
    showReference: true,
    params:
      '[{"id":"signal","kind":"range","min":0.2,"max":0.8,"step":0.1,"default":0.45,"label":"Signal intensity"},{"id":"density","kind":"steps","default":"balanced","label":"Density","options":[{"value":"airy","label":"Airy"},{"value":"balanced","label":"Balanced"},{"value":"tight","label":"Tight"}]}]',
  },
  {
    id: "2",
    className: "rail",
    visible: false,
    showReference: false,
    params:
      '[{"id":"rail","kind":"range","min":0.55,"max":0.95,"step":0.05,"default":0.72,"label":"Rail emphasis"},{"id":"density","kind":"steps","default":"balanced","label":"Density","options":[{"value":"airy","label":"Airy"},{"value":"balanced","label":"Balanced"},{"value":"tight","label":"Tight"}]}]',
  },
  {
    id: "3",
    className: "dense",
    visible: false,
    showReference: false,
    params:
      '[{"id":"rule","kind":"range","min":0.2,"max":0.8,"step":0.1,"default":0.42,"label":"Rule intensity"},{"id":"edge-markers","kind":"toggle","default":false,"label":"HUD edge markers"}]',
  },
] as const;

type CommandCenterVariantConfig = (typeof COMMAND_CENTER_VARIANTS)[number];

interface CommandCenterVariantProps {
  brand: string;
  typed: string;
  activeProfileId: string | null;
  profiles: Profile[];
  variants: ProfileVariantDto[];
  selectedVariantId: string | null;
  selectedVariant: ProfileVariantDto | null;
  onProfileChange: (id: string) => Promise<void>;
  onVariantChange: (id: string) => void;
  cvs: CvDocument[];
  selectedCvId: string;
  onCvChange: (id: string) => void;
  onOpenGmail: () => void;
  jobCount: number;
  recentJobs: JobPostDto[];
  opening: boolean;
  onOpenAllLogins: () => Promise<void>;
  autoConnect: boolean;
  onAutoConnectChange: (checked: boolean) => void;
  acStatus: string;
  loginError: string | null;
}

function ReferenceOverview({ jobCount }: { jobCount: number }) {
  return (
    <>
      <section className="cc-reference-metrics" aria-label="Workspace overview">
        <article className="cc-reference-metric">
          <div className="cc-reference-metric__top">
            <span>Total Revenue</span>
            <b>↗ +12.5%</b>
          </div>
          <strong>$1,250.00</strong>
          <div className="cc-reference-metric__detail">
            <span>Trending up this month</span>
            <small>Visitors for the last 6 months</small>
          </div>
        </article>
        <article className="cc-reference-metric">
          <div className="cc-reference-metric__top">
            <span>New Customers</span>
            <b>↘ -20%</b>
          </div>
          <strong>1,234</strong>
          <div className="cc-reference-metric__detail">
            <span>Down 20% this period</span>
            <small>Acquisition needs attention</small>
          </div>
        </article>
        <article className="cc-reference-metric">
          <div className="cc-reference-metric__top">
            <span>Active Applications</span>
            <b>↗ +8.4%</b>
          </div>
          <strong>{jobCount.toLocaleString()}</strong>
          <div className="cc-reference-metric__detail">
            <span>Strong user activity</span>
            <small>Engagement across your workspace</small>
          </div>
        </article>
      </section>

      <section className="cc-reference-bridge" aria-labelledby="bridge-title">
        <div>
          <h2 id="bridge-title">Rust bridge</h2>
          <p>Call the bundled Tauri command and render the response from Rust.</p>
        </div>
        <input aria-label="Rust bridge name" placeholder="Enter a name" />
      </section>

      <section className="cc-reference-visitors" aria-labelledby="visitors-title">
        <header>
          <h2 id="visitors-title">Total Visitors</h2>
          <p>Total for the last 3 months</p>
        </header>
        <div className="cc-reference-visitors__chart">
          <VisitorsChart />
        </div>
      </section>
    </>
  );
}

function CommandCenterVariantView({
  variant,
  brand,
  typed,
  activeProfileId,
  profiles,
  variants,
  selectedVariantId,
  selectedVariant,
  onProfileChange,
  onVariantChange,
  cvs,
  selectedCvId,
  onCvChange,
  onOpenGmail,
  jobCount,
  recentJobs,
  opening,
  onOpenAllLogins,
  autoConnect,
  onAutoConnectChange,
  acStatus,
  loginError,
}: CommandCenterVariantProps & { variant: CommandCenterVariantConfig }) {
  return (
    <div
      data-impeccable-variant={variant.id}
      style={variant.visible ? undefined : { display: "none" }}
      data-impeccable-params={variant.params}
    >
      <div className={`page cc cc-variant--${variant.className}`}>
        <header className="cc-brand">
          <h1 aria-label={brand}>
            <span aria-hidden="true">{typed}</span>
            <span className="cc-caret" aria-hidden="true" />
          </h1>
        </header>

        {variant.showReference ? <ReferenceOverview jobCount={jobCount} /> : null}

        <section className="cc-icons hud-frame" aria-label="Platforms">
          <PlatformHub variant={selectedVariant} />
        </section>

        <div className="cc-midgrid">
          <section className="cc-zone cc-zone--tips">
            <header className="cc-zone__head">
              <h2>Descrição</h2>
              <span className="cc-zone__aside">dicas da ENI</span>
            </header>
            <DialogueTips tips={TIPS} />
          </section>

          <section className="cc-zone cc-zone--mail">
            <header className="cc-zone__head">
              <Icon icon={Mail01Icon} size={16} />
              <h2>Feed Email</h2>
            </header>
            <p className="cc-zone__muted">
              Open your inbox in the shared browser, and pick the CV that goes out with email
              applications.
            </p>
            <label className="cc-field">
              <span className="cc-field__label">CV for emails</span>
              <Dropdown
                aria-label="CV for emails"
                value={selectedCvId}
                onChange={onCvChange}
                placeholder="— none —"
                options={[
                  { value: "", label: "— none —" },
                  ...cvs.map((c) => ({ value: c.id, label: c.fileName })),
                ]}
              />
            </label>
            <Button
              variant="ghost"
              size="sm"
              icon={<Icon icon={InboxIcon} size={15} />}
              onClick={onOpenGmail}
              disabled={!activeProfileId}
            >
              Open Gmail
            </Button>
          </section>
        </div>

        <div className="cc-botgrid">
          <section className="cc-zone cc-zone--login">
            <header className="cc-zone__head">
              <Icon icon={Login03Icon} size={16} />
              <h2>Login Universal</h2>
            </header>
            <p className="cc-zone__muted">
              One window — every job site <em>and ChatGPT</em>. Sign into each tab once; cookies
              persist for every fill, search, and AI rewrite.
            </p>
            <Button
              variant="primary"
              icon={<Icon icon={Login03Icon} size={16} />}
              onClick={() => void onOpenAllLogins()}
              disabled={opening || !activeProfileId}
            >
              {opening ? "Opening…" : "Open all logins"}
            </Button>

            <Switch
              checked={autoConnect}
              onChange={onAutoConnectChange}
              disabled={!activeProfileId}
            >
              Auto-connect on LinkedIn (until weekly limit)
            </Switch>
            {acStatus && <p className="cc-zone__muted">{acStatus}</p>}

            {!activeProfileId && (
              <p className="cc-zone__muted">
                Select a profile first — logins attach to its browser.
              </p>
            )}
            {loginError && (
              <p className="cc-danger" role="alert">
                {loginError}
              </p>
            )}
          </section>

          <section className="cc-zone cc-zone--jobs">
            <header className="cc-zone__head">
              <Icon icon={Search01Icon} size={16} />
              <h2>Vagas encontradas</h2>
              <span className="cc-zone__aside">{jobCount}</span>
            </header>
            {recentJobs.length === 0 ? (
              <div className="cc-empty">
                <Icon icon={Search01Icon} size={22} />
                <p>No jobs yet. Run a search and matches land here live.</p>
                <Link className="cc-action" to="/job-search">
                  <span>Go to Job Search</span>
                  <Icon icon={ArrowRight02Icon} size={13} />
                </Link>
              </div>
            ) : (
              <ol className="cc-joblist">
                {recentJobs.map((job) => (
                  <li className="cc-jobrow" key={job.id}>
                    <a href={job.url} target="_blank" rel="noreferrer" className="cc-jobrow__main">
                      <strong>{job.title}</strong>
                      <span>
                        {job.company}
                        {job.location ? ` · ${job.location}` : ""}
                      </span>
                    </a>
                    <span className="cc-jobrow__platform">{job.platform}</span>
                  </li>
                ))}
              </ol>
            )}
            {jobCount > recentJobs.length && (
              <Link className="cc-zone__cta" to="/job-search">
                View all {jobCount} jobs
                <Icon icon={ArrowRight02Icon} size={13} />
              </Link>
            )}
          </section>
        </div>

        <section className="cc-foot">
          <label className="cc-field">
            <span className="cc-field__label">Profile</span>
            <Dropdown
              aria-label="Profile"
              title="Profiles"
              value={activeProfileId ?? ""}
              onChange={(id) => void onProfileChange(id)}
              placeholder="No profiles"
              options={profiles.map((p) => ({ value: p.id, label: p.name }))}
            />
          </label>
          <label className="cc-field">
            <span className="cc-field__label">Profile variant</span>
            <Dropdown
              aria-label="Profile variant"
              title="Variants"
              value={selectedVariantId ?? ""}
              onChange={onVariantChange}
              placeholder="No variants"
              disabled={variants.length === 0}
              options={variants.map((v) => ({
                value: v.id,
                label: v.targetTitle ? `${v.name} — ${v.targetTitle}` : v.name,
              }))}
            />
          </label>
        </section>
      </div>
    </div>
  );
}

export function CommandCenterVariants(props: CommandCenterVariantProps) {
  return (
    <>
      {COMMAND_CENTER_VARIANTS.map((variant) => (
        <CommandCenterVariantView key={variant.id} {...props} variant={variant} />
      ))}
    </>
  );
}
