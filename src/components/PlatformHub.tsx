import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invokeStrict } from "../lib/tauriInvoke";
import type { ProfileVariantDto, SyncSectionResult } from "../types/domain";
import linkedinIcon from "../assets/platform-icons/linkedin.png";
import cathoIcon from "../assets/platform-icons/catho.png";
import infojobsIcon from "../assets/platform-icons/infojobs.png";
import indeedIcon from "../assets/platform-icons/indeed.png";
import gupyIcon from "../assets/platform-icons/gupy.png";
import upworkIcon from "../assets/platform-icons/upwork.svg";
import freelas99Icon from "../assets/platform-icons/freelas99.svg";
import inhireIcon from "../assets/platform-icons/inhire.svg";

/** One action a platform icon offers. `fill`/`sync` invoke a push command against
 *  the selected variant; `link` navigates. Login is intentionally absent — the
 *  Universal Login button covers every site (incl. ChatGPT) in one window. */
interface Action {
  label: string;
  command?: string;
  args?: Record<string, unknown>;
  to?: string;
}
interface Plat {
  key: string;
  label: string;
  icon: string;
  actions: Action[];
}

const PLATFORMS: Plat[] = [
  {
    key: "linkedin",
    label: "LinkedIn",
    icon: linkedinIcon,
    actions: [
      { label: "Sync profile", command: "push_variant_to_linkedin", args: { sectionIds: null } },
      { label: "Search LinkedIn", to: "/job-search" },
    ],
  },
  {
    key: "catho",
    label: "Catho",
    icon: cathoIcon,
    actions: [{ label: "Fill Catho resume", command: "push_variant_to_catho", args: { sectionIds: null } }],
  },
  {
    key: "gupy",
    label: "Gupy",
    icon: gupyIcon,
    actions: [{ label: "Fill Gupy resume", command: "push_variant_to_gupy" }],
  },
  {
    key: "infojobs",
    label: "InfoJobs",
    icon: infojobsIcon,
    actions: [{ label: "Fill InfoJobs CV", command: "push_variant_to_infojobs" }],
  },
  {
    key: "indeed",
    label: "Indeed",
    icon: indeedIcon,
    actions: [{ label: "Search Indeed", to: "/job-search" }],
  },
  {
    key: "upwork",
    label: "Upwork",
    icon: upworkIcon,
    actions: [{ label: "Search Upwork", to: "/job-search" }],
  },
  {
    key: "99freelas",
    label: "99freelas",
    icon: freelas99Icon,
    actions: [{ label: "Search 99freelas", to: "/job-search" }],
  },
  {
    // inhire has no direct scraper — its `*.inhire.app/vagas` postings surface
    // through the Google Dork search (see build_google_dork).
    key: "inhire",
    label: "inhire",
    icon: inhireIcon,
    actions: [{ label: "Find inhire jobs (Dork)", to: "/job-search" }],
  },
];

/**
 * The platform hub: a row of clickable real-favicon icons. Clicking one opens a
 * popover of that site's actions (fill/sync/search) — never login. Fill/sync run
 * against the selected profile variant and report a compact result inline.
 */
export function PlatformHub({ variant }: { variant: ProfileVariantDto | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: string; text: string; ok: boolean } | null>(null);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function run(platKey: string, a: Action) {
    if (a.to) {
      navigate(a.to);
      setOpen(null);
      return;
    }
    if (!a.command) return;
    if (!variant) {
      setResult({ key: platKey, text: "Select a profile variant first", ok: false });
      return;
    }
    setBusy(a.label);
    setResult(null);
    try {
      const res = await invokeStrict<SyncSectionResult[]>(a.command, {
        variantId: variant.id,
        ...(a.args ?? {}),
      });
      const ok = res.filter((r) => r.status === "ok").length;
      const bad = res.filter((r) => r.status === "error").length;
      setResult({ key: platKey, text: `${ok} filled${bad ? `, ${bad} failed` : ""}`, ok: bad === 0 });
    } catch (e) {
      setResult({ key: platKey, text: e instanceof Error ? e.message : String(e), ok: false });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="cc-hub" ref={ref}>
      {PLATFORMS.map((p) => (
        <div key={p.key} className="cc-hub__item">
          <button
            type="button"
            className={open === p.key ? "cc-hub__icon is-open" : "cc-hub__icon"}
            onClick={() => setOpen(open === p.key ? null : p.key)}
            title={p.label}
            aria-expanded={open === p.key}
            aria-label={p.label}
          >
            <img src={p.icon} alt={p.label} />
          </button>
          {open === p.key && (
            <div className="cc-hub__pop" role="menu">
              <span className="cc-hub__pop-title">{p.label}</span>
              {p.actions.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className="cc-hub__action"
                  role="menuitem"
                  disabled={busy !== null}
                  onClick={() => void run(p.key, a)}
                >
                  {busy === a.label ? "Working…" : a.label}
                </button>
              ))}
              {result?.key === p.key && (
                <span className={result.ok ? "cc-hub__result is-ok" : "cc-hub__result is-err"}>
                  {result.text}
                </span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
