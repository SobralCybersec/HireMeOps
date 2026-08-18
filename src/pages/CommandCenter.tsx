import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight02Icon,
  InboxIcon,
  Login03Icon,
  Mail01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { Button, Dropdown, Icon, Switch } from "../components/ui";
import { VisitorsChart } from "../components/ui/VisitorsChart";
import { PlatformHub } from "../components/PlatformHub";
import { useJobStore } from "../stores/useJobStore";
import { useProfileStore } from "../stores/useProfileStore";
import { useProfileVariantStore } from "../stores/useProfileVariantStore";
import { Channel } from "@tauri-apps/api/core";
import { invokeStrict, safeInvoke } from "../lib/tauriInvoke";
import type { CvDocument } from "../types/domain";
import "./CommandCenter.css";

/** Persisted key for the CV chosen in the Command Center for email applications. */
const CV_KEY = "hiremeops-selected-cv";

interface Tip {
  title: string;
  content: string;
  /** A substring of `content` to accent (Zelda-style highlight). Optional. */
  highlight?: string;
}

/** ENI's rotating field notes — shown as a dialogue box. Edit freely; the box
 *  cycles them at random (no immediate repeat) and on the Next-tip click. */
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

/** Accent one substring of a tip's content, Zelda-highlight style. */
function renderTip(content: string, highlight?: string) {
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

/**
 * ENI's tips as a Zelda-style dialogue box: a speaker name-tag, an accented
 * title + line, a floating "continue" triangle, and a Next-tip control. Cycles
 * at random (never the same tip twice running) on a timer and on click, with a
 * quick cross-fade. Timer is cleaned up on unmount.
 */
function DialogueTips({ tips }: { tips: Tip[] }) {
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(true);
  const timers = useRef<number[]>([]);

  const advance = useCallback(() => {
    setShown(false); // fade out, then swap + fade in
    const id = window.setTimeout(() => {
      setIndex((cur) => {
        if (tips.length < 2) return cur;
        let n = cur;
        while (n === cur) n = Math.floor(Math.random() * tips.length);
        return n;
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

/**
 * Command Center — the hub. A row of clickable platform icons (each opens its own
 * actions, never login), ENI's tips, a Gmail peek + CV-for-emails selector, the
 * one Universal Login button (all job sites + ChatGPT), the live Vagas feed, an
 * auto-connect toggle, and profile/variant selectors at the foot.
 */

// Single-flight guard for the auto-connect run. It opens a browser on the shared profile dir, and a
// SECOND concurrent open reclaims (kills) the first → "Target page closed". Module-level so it
// survives Command-Center remounts (navigation): a remount can't spawn a second overlapping run
// while one is still in flight.
let autoConnectRunActive = false;

export function CommandCenter() {
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const profiles = useProfileStore((s) => s.profiles);
  const loadProfiles = useProfileStore((s) => s.loadProfiles);
  const setActiveProfile = useProfileStore((s) => s.setActiveProfile);

  const variants = useProfileVariantStore((s) => s.variants);
  const loadVariants = useProfileVariantStore((s) => s.loadVariants);

  const jobs = useJobStore((s) => s.jobs);
  const loadJobs = useJobStore((s) => s.loadJobs);

  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [cvs, setCvs] = useState<CvDocument[]>([]);
  const [selectedCvId, setSelectedCvId] = useState<string>(
    () => localStorage.getItem(CV_KEY) ?? "",
  );
  const [opening, setOpening] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Auto-connect toggle: while on, loops LinkedIn auto-connect (headless per the
  // linkedin_connect task setting) until the weekly limit, then self-disables.
  // Persisted to localStorage so leaving Command Center and coming back doesn't reset it to off
  // (it's component state — navigating away unmounts it); the run resumes on return.
  const AC_KEY = "hiremeops-autoconnect";
  const [autoConnect, setAutoConnectState] = useState(() => localStorage.getItem(AC_KEY) === "1");
  const setAutoConnect = useCallback((v: boolean) => {
    setAutoConnectState(v);
    localStorage.setItem(AC_KEY, v ? "1" : "0");
  }, []);
  const [acStatus, setAcStatus] = useState<string>("");

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (!activeProfileId) return;
    void loadJobs(activeProfileId);
    void loadVariants(activeProfileId);
    void safeInvoke<CvDocument[]>("list_cv_documents", { profileId: activeProfileId }).then(
      (list) => setCvs(list ?? []),
    );
  }, [activeProfileId, loadJobs, loadVariants]);

  // Default the variant to the first once variants load / profile changes.
  useEffect(() => {
    if (variants.length && !variants.some((v) => v.id === selectedVariantId)) {
      setSelectedVariantId(variants[0].id);
    }
  }, [variants, selectedVariantId]);

  useEffect(() => {
    if (!autoConnect || !activeProfileId) return;
    if (autoConnectRunActive) return; // a run from a prior mount is still in flight — don't overlap
    autoConnectRunActive = true;
    let cancelled = false;
    (async () => {
      try {
        let total = 0;
        setAcStatus("Connecting…");
        while (!cancelled) {
          try {
            // SSE-style live counter: the backend streams one tick per confirmed invite (and one on
            // limit) over this channel, so "Sent N" climbs in real time instead of jumping only when
            // the (up-to-200) call returns. `base` = invites confirmed in PRIOR calls this run.
            const base = total;
            const channel = new Channel<{ sent: number; status: "ok" | "limit" }>();
            channel.onmessage = (p) => {
              if (cancelled) return;
              setAcStatus(
                p.status === "limit"
                  ? `⚠ Weekly connection limit reached — sent ${base + p.sent}.`
                  : `Sent ${base + p.sent}…`,
              );
            };
            const r = await invokeStrict<{ sent: number; status: "ok" | "limit" }>(
              "auto_connect_linkedin",
              // High per-call ceiling so one session drives all the way to LinkedIn's weekly limit
              // (the real stop) instead of quitting at an arbitrary 20; the worker keeps scrolling +
              // refreshing for fresh "Sugestões para você" cards until `limit` or truly dry.
              { maxCount: 200, channel },
            );
            total += r.sent;
            setAcStatus(`Sent ${total}…`);
            if (r.status === "limit") {
              setAcStatus(`Weekly limit reached — sent ${total}.`);
              setAutoConnect(false);
              break;
            }
            if (r.sent === 0) {
              setAcStatus(`Done — sent ${total}.`);
              setAutoConnect(false);
              break;
            }
          } catch (e) {
            setAcStatus(e instanceof Error ? e.message : String(e));
            setAutoConnect(false);
            break;
          }
          await new Promise((res) => setTimeout(res, 1500));
        }
      } finally {
        autoConnectRunActive = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoConnect, activeProfileId, setAutoConnect]);

  const selectedVariant = variants.find((v) => v.id === selectedVariantId) ?? null;

  const openAllLogins = useCallback(async () => {
    if (!activeProfileId || opening) return;
    setOpening(true);
    setLoginError(null);
    try {
      await invokeStrict("open_all_logins", { profileId: activeProfileId });
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpening(false);
    }
  }, [activeProfileId, opening]);

  const openGmail = useCallback(() => {
    if (!activeProfileId) return;
    void safeInvoke("open_gmail", { profileId: activeProfileId });
  }, [activeProfileId]);

  const pickCv = (id: string) => {
    setSelectedCvId(id);
    if (id) localStorage.setItem(CV_KEY, id);
    else localStorage.removeItem(CV_KEY);
  };

  const recentJobs = jobs.slice(0, 12);

  // Typewriter for the wordmark — types "HireMeOps" out with a blinking caret. Skips the animation
  // (shows the full title immediately) under prefers-reduced-motion.
  const BRAND = "HireMeOps";
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [typed, setTyped] = useState(reduceMotion ? BRAND : "");
  useEffect(() => {
    if (reduceMotion) return;
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setTyped(BRAND.slice(0, i));
      if (i >= BRAND.length) window.clearInterval(id);
    }, 120);
    return () => window.clearInterval(id);
  }, [reduceMotion]);

  return (
    <div
      data-impeccable-variants="b7f9f8f8"
      data-impeccable-variant-count="3"
      style={{ display: "contents" }}
    >
      {/* impeccable-variants-start b7f9f8f8 */}
      <style data-impeccable-css="b7f9f8f8">{`
        @scope ([data-impeccable-variant="1"]) {
          :scope > .cc-variant--focus {
            --cc-signal: var(--p-signal, 0.45);
            display: grid;
            grid-template-columns: minmax(0, 1fr);
            grid-template-areas: "brand" "metrics" "bridge" "visitors" "icons" "mid" "bot" "foot";
            gap: 16px;
            padding: 24px;
            background: linear-gradient(180deg, color-mix(in srgb, var(--color-accent) 4%, var(--color-bg)), var(--color-bg) 24%);
          }
          :scope > .cc-variant--focus .cc-brand { grid-area: brand; padding-bottom: 4px; }
          :scope > .cc-variant--focus .cc-brand h1 { font-size: clamp(24px, 3vw, 38px); letter-spacing: -0.02em; }
          :scope > .cc-variant--focus .cc-icons { grid-area: icons; border-color: color-mix(in srgb, var(--color-accent) calc(var(--cc-signal) * 100%), var(--color-border)); }
          :scope > .cc-variant--focus .cc-icons::before { opacity: var(--cc-signal); }
          :scope > .cc-variant--focus .cc-midgrid { grid-area: mid; grid-template-columns: minmax(0, 1.45fr) minmax(260px, 0.75fr); }
          :scope > .cc-variant--focus .cc-botgrid { grid-area: bot; grid-template-columns: minmax(260px, 0.8fr) minmax(0, 1.6fr); }
          :scope > .cc-variant--focus .cc-zone { box-shadow: 0 10px 28px rgb(0 0 0 / 0.18); }
          :scope > .cc-variant--focus .cc-zone--jobs { min-height: 240px; }
          :scope > .cc-variant--focus .cc-foot { grid-area: foot; max-width: 760px; }
          :scope > .cc-variant--focus[data-p-density="tight"] { gap: 10px; padding: 16px; }
          :scope > .cc-variant--focus[data-p-density="airy"] { gap: 24px; padding: 32px; }
          @media (max-width: 900px) {
            :scope > .cc-variant--focus { padding: 16px; }
            :scope > .cc-variant--focus .cc-midgrid,
            :scope > .cc-variant--focus .cc-botgrid { grid-template-columns: 1fr; }
          }
        }

        @scope ([data-impeccable-variant="2"]) {
          :scope > .cc-variant--rail {
            --cc-rail: var(--p-rail, 0.72);
            display: grid;
            grid-template-columns: clamp(188px, 22vw, 270px) minmax(0, 1fr);
            grid-template-areas: "brand brand" "icons mid" "icons bot" "foot foot";
            gap: 16px;
            padding: 20px;
            background: var(--color-bg);
          }
          :scope > .cc-variant--rail .cc-brand { grid-area: brand; display: flex; align-items: end; min-height: 44px; }
          :scope > .cc-variant--rail .cc-brand h1 { font-size: 22px; }
          :scope > .cc-variant--rail .cc-icons { grid-area: icons; align-self: stretch; min-height: 520px; padding: 16px; background: color-mix(in srgb, var(--color-surface-2) calc(var(--cc-rail) * 100%), var(--color-surface)); }
          :scope > .cc-variant--rail .cc-hub { align-content: start; grid-template-columns: repeat(2, minmax(0, 1fr)); }
          :scope > .cc-variant--rail .cc-midgrid { grid-area: mid; grid-template-columns: minmax(0, 1fr) minmax(220px, 0.72fr); }
          :scope > .cc-variant--rail .cc-botgrid { grid-area: bot; grid-template-columns: minmax(220px, 0.72fr) minmax(0, 1.28fr); }
          :scope > .cc-variant--rail .cc-zone { border-radius: var(--radius-md); }
          :scope > .cc-variant--rail .cc-zone--tips { min-height: 250px; }
          :scope > .cc-variant--rail .cc-foot { grid-area: foot; justify-content: end; }
          :scope > .cc-variant--rail[data-p-density="tight"] .cc-zone { padding: 12px; }
          :scope > .cc-variant--rail[data-p-density="airy"] { gap: 24px; }
          @media (max-width: 900px) {
            :scope > .cc-variant--rail { grid-template-columns: 1fr; grid-template-areas: "brand" "icons" "mid" "bot" "foot"; }
            :scope > .cc-variant--rail .cc-icons { min-height: 0; }
            :scope > .cc-variant--rail .cc-midgrid,
            :scope > .cc-variant--rail .cc-botgrid { grid-template-columns: 1fr; }
          }
        }

        @scope ([data-impeccable-variant="3"]) {
          :scope > .cc-variant--dense {
            --cc-rule: var(--p-rule, 0.42);
            display: grid;
            grid-template-columns: minmax(0, 1fr);
            grid-template-areas: "brand" "icons" "bot" "mid" "foot";
            gap: 12px;
            padding: 16px;
            background: var(--color-surface-sunken);
          }
          :scope > .cc-variant--dense .cc-brand { grid-area: brand; display: flex; justify-content: space-between; align-items: center; }
          :scope > .cc-variant--dense .cc-brand h1 { font-size: 20px; letter-spacing: 0.01em; }
          :scope > .cc-variant--dense .cc-icons { grid-area: icons; padding: 8px 12px; border-top-color: color-mix(in srgb, var(--color-accent) calc(var(--cc-rule) * 100%), var(--color-border)); }
          :scope > .cc-variant--dense .cc-hub { display: flex; flex-wrap: nowrap; overflow-x: auto; justify-content: flex-start; gap: 8px; }
          :scope > .cc-variant--dense .cc-hub__icon { width: 34px; height: 34px; }
          :scope > .cc-variant--dense .cc-midgrid { grid-area: mid; grid-template-columns: minmax(0, 1fr) minmax(240px, 0.85fr); }
          :scope > .cc-variant--dense .cc-botgrid { grid-area: bot; grid-template-columns: minmax(240px, 0.85fr) minmax(0, 1.15fr); }
          :scope > .cc-variant--dense .cc-zone { box-shadow: var(--shadow-1); }
          :scope > .cc-variant--dense .cc-zone__head { padding-bottom: 8px; }
          :scope > .cc-variant--dense .cc-zone--jobs { min-height: 220px; }
          :scope > .cc-variant--dense .cc-foot { grid-area: foot; border-top: 1px solid var(--color-border); padding-top: 12px; }
          :scope > .cc-variant--dense[data-p-edge-markers] .cc-zone::before { opacity: 0.9; }
          @media (max-width: 900px) {
            :scope > .cc-variant--dense .cc-midgrid,
            :scope > .cc-variant--dense .cc-botgrid { grid-template-columns: 1fr; }
          }
        }
      `}</style>

      {/* Variant 1: hierarchy axis — brand and live platform signal lead the workspace. */}
      <div
        data-impeccable-variant="1"
        data-impeccable-params='[{"id":"signal","kind":"range","min":0.2,"max":0.8,"step":0.1,"default":0.45,"label":"Signal intensity"},{"id":"density","kind":"steps","default":"balanced","label":"Density","options":[{"value":"airy","label":"Airy"},{"value":"balanced","label":"Balanced"},{"value":"tight","label":"Tight"}]}]'
      >
        <div className="page cc cc-variant--focus">
          <header className="cc-brand">
            <h1 aria-label={BRAND}>
              <span aria-hidden="true">{typed}</span>
              <span className="cc-caret" aria-hidden="true" />
            </h1>
          </header>

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
              <strong>{jobs.length.toLocaleString()}</strong>
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

          {/* Zone 1 — clickable platform icons (each opens its own actions). */}
          <section className="cc-icons hud-frame" aria-label="Platforms">
            <PlatformHub variant={selectedVariant} />
          </section>

          {/* Zone 2 — Descrição (tips) + Feed Email (with CV-for-emails selector). */}
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
                  onChange={pickCv}
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
                onClick={openGmail}
                disabled={!activeProfileId}
              >
                Open Gmail
              </Button>
            </section>
          </div>

          {/* Zone 3 — Universal Login + Vagas/Jobs encontrados. */}
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
                onClick={() => void openAllLogins()}
                disabled={opening || !activeProfileId}
              >
                {opening ? "Opening…" : "Open all logins"}
              </Button>

              <Switch checked={autoConnect} onChange={setAutoConnect} disabled={!activeProfileId}>
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
                <span className="cc-zone__aside">{jobs.length}</span>
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
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noreferrer"
                        className="cc-jobrow__main"
                      >
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
              {jobs.length > recentJobs.length && (
                <Link className="cc-zone__cta" to="/job-search">
                  View all {jobs.length} jobs
                  <Icon icon={ArrowRight02Icon} size={13} />
                </Link>
              )}
            </section>
          </div>

          {/* Foot — profile + variant selectors. */}
          <section className="cc-foot">
            <label className="cc-field">
              <span className="cc-field__label">Profile</span>
              <Dropdown
                aria-label="Profile"
                title="Profiles"
                value={activeProfileId ?? ""}
                onChange={(id) => void setActiveProfile(id)}
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
                onChange={setSelectedVariantId}
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

      {/* Variant 2: topology axis — a tall platform rail anchors the workspace. */}
      <div
        data-impeccable-variant="2"
        style={{ display: "none" }}
        data-impeccable-params='[{"id":"rail","kind":"range","min":0.55,"max":0.95,"step":0.05,"default":0.72,"label":"Rail emphasis"},{"id":"density","kind":"steps","default":"balanced","label":"Density","options":[{"value":"airy","label":"Airy"},{"value":"balanced","label":"Balanced"},{"value":"tight","label":"Tight"}]}]'
      >
        <div className="page cc cc-variant--rail">
          <header className="cc-brand">
            <h1 aria-label={BRAND}>
              <span aria-hidden="true">{typed}</span>
              <span className="cc-caret" aria-hidden="true" />
            </h1>
          </header>

          {/* Zone 1 — clickable platform icons (each opens its own actions). */}
          <section className="cc-icons hud-frame" aria-label="Platforms">
            <PlatformHub variant={selectedVariant} />
          </section>

          {/* Zone 2 — Descrição (tips) + Feed Email (with CV-for-emails selector). */}
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
                  onChange={pickCv}
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
                onClick={openGmail}
                disabled={!activeProfileId}
              >
                Open Gmail
              </Button>
            </section>
          </div>

          {/* Zone 3 — Universal Login + Vagas/Jobs encontrados. */}
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
                onClick={() => void openAllLogins()}
                disabled={opening || !activeProfileId}
              >
                {opening ? "Opening…" : "Open all logins"}
              </Button>

              <Switch checked={autoConnect} onChange={setAutoConnect} disabled={!activeProfileId}>
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
                <span className="cc-zone__aside">{jobs.length}</span>
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
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noreferrer"
                        className="cc-jobrow__main"
                      >
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
              {jobs.length > recentJobs.length && (
                <Link className="cc-zone__cta" to="/job-search">
                  View all {jobs.length} jobs
                  <Icon icon={ArrowRight02Icon} size={13} />
                </Link>
              )}
            </section>
          </div>

          {/* Foot — profile + variant selectors. */}
          <section className="cc-foot">
            <label className="cc-field">
              <span className="cc-field__label">Profile</span>
              <Dropdown
                aria-label="Profile"
                title="Profiles"
                value={activeProfileId ?? ""}
                onChange={(id) => void setActiveProfile(id)}
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
                onChange={setSelectedVariantId}
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

      {/* Variant 3: density axis — a flat data desk prioritizes the live job ledger. */}
      <div
        data-impeccable-variant="3"
        style={{ display: "none" }}
        data-impeccable-params='[{"id":"rule","kind":"range","min":0.2,"max":0.8,"step":0.1,"default":0.42,"label":"Rule intensity"},{"id":"edge-markers","kind":"toggle","default":false,"label":"HUD edge markers"}]'
      >
        <div className="page cc cc-variant--dense">
          <header className="cc-brand">
            <h1 aria-label={BRAND}>
              <span aria-hidden="true">{typed}</span>
              <span className="cc-caret" aria-hidden="true" />
            </h1>
          </header>

          {/* Zone 1 — clickable platform icons (each opens its own actions). */}
          <section className="cc-icons hud-frame" aria-label="Platforms">
            <PlatformHub variant={selectedVariant} />
          </section>

          {/* Zone 2 — Descrição (tips) + Feed Email (with CV-for-emails selector). */}
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
                  onChange={pickCv}
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
                onClick={openGmail}
                disabled={!activeProfileId}
              >
                Open Gmail
              </Button>
            </section>
          </div>

          {/* Zone 3 — Universal Login + Vagas/Jobs encontrados. */}
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
                onClick={() => void openAllLogins()}
                disabled={opening || !activeProfileId}
              >
                {opening ? "Opening…" : "Open all logins"}
              </Button>

              <Switch checked={autoConnect} onChange={setAutoConnect} disabled={!activeProfileId}>
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
                <span className="cc-zone__aside">{jobs.length}</span>
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
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noreferrer"
                        className="cc-jobrow__main"
                      >
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
              {jobs.length > recentJobs.length && (
                <Link className="cc-zone__cta" to="/job-search">
                  View all {jobs.length} jobs
                  <Icon icon={ArrowRight02Icon} size={13} />
                </Link>
              )}
            </section>
          </div>

          {/* Foot — profile + variant selectors. */}
          <section className="cc-foot">
            <label className="cc-field">
              <span className="cc-field__label">Profile</span>
              <Dropdown
                aria-label="Profile"
                title="Profiles"
                value={activeProfileId ?? ""}
                onChange={(id) => void setActiveProfile(id)}
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
                onChange={setSelectedVariantId}
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
      {/* impeccable-variants-end b7f9f8f8 */}
    </div>
  );
}
