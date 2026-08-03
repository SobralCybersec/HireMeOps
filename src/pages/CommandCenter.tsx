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
  const [selectedCvId, setSelectedCvId] = useState<string>(() => localStorage.getItem(CV_KEY) ?? "");
  const [opening, setOpening] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Auto-connect toggle: while on, loops LinkedIn auto-connect (headless per the
  // linkedin_connect task setting) until the weekly limit, then self-disables.
  // Persisted to localStorage so leaving Command Center and coming back doesn't reset it to off
  // (it's component state — navigating away unmounts it); the run resumes on return.
  const AC_KEY = "hiremeops-autoconnect";
  const [autoConnect, setAutoConnectState] = useState(
    () => localStorage.getItem(AC_KEY) === "1",
  );
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
    void safeInvoke<CvDocument[]>("list_cv_documents", { profileId: activeProfileId }).then((list) =>
      setCvs(list ?? []),
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
  }, [autoConnect, activeProfileId]);

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
    <div className="page cc">
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
            Open your inbox in the shared browser, and pick the CV that goes out with email applications.
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
            One window — every job site <em>and ChatGPT</em>. Sign into each tab once; cookies persist for
            every fill, search, and AI rewrite.
          </p>
          <Button
            variant="primary"
            icon={<Icon icon={Login03Icon} size={16} />}
            onClick={() => void openAllLogins()}
            disabled={opening || !activeProfileId}
          >
            {opening ? "Opening…" : "Open all logins"}
          </Button>

          <Switch
            checked={autoConnect}
            onChange={setAutoConnect}
            disabled={!activeProfileId}
          >
            Auto-connect on LinkedIn (until weekly limit)
          </Switch>
          {acStatus && <p className="cc-zone__muted">{acStatus}</p>}

          {!activeProfileId && (
            <p className="cc-zone__muted">Select a profile first — logins attach to its browser.</p>
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
  );
}
