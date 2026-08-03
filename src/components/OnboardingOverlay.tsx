import { useCallback, useEffect, useState } from "react";
import { invokeStrict } from "../lib/tauriInvoke";
import linkedinIcon from "../assets/platform-icons/linkedin.png";
import cathoIcon from "../assets/platform-icons/catho.png";
import infojobsIcon from "../assets/platform-icons/infojobs.png";
import indeedIcon from "../assets/platform-icons/indeed.png";
import gupyIcon from "../assets/platform-icons/gupy.png";
import gptIcon from "../assets/platform-icons/gpt.png";
import "./OnboardingOverlay.css";

const SEEN_KEY = "hiremeops-onboarded";
const ICONS = [linkedinIcon, indeedIcon, cathoIcon, gupyIcon, infojobsIcon, gptIcon];

interface Slide {
  eyebrow: string;
  title: string;
  body: string;
  showIcons?: boolean;
  install?: boolean;
}

const SLIDES: Slide[] = [
  {
    eyebrow: "Welcome",
    title: "HireMeOps",
    body: "Your local-first job hunt, on autopilot. ENI drives a real browser so you don't have to — searching, tailoring, and applying across every board.",
  },
  {
    eyebrow: "Step 01",
    title: "One Universal Login",
    body: "Sign into LinkedIn, Indeed, Catho, Gupy, InfoJobs — and ChatGPT — in a single window. One click on the Command Center; the session is remembered everywhere.",
    showIcons: true,
  },
  {
    eyebrow: "Step 02",
    title: "Search Everywhere",
    body: "“Search all” fires every platform at once and pours the matches into one live feed. Narrow it with a keyword and a location filter to zero in.",
  },
  {
    eyebrow: "Step 03",
    title: "Auto-Fill Your Resume",
    body: "Click a platform's icon in the Command Center and ENI types your profile variant straight into Catho, Gupy, InfoJobs, and LinkedIn — zero copy-paste.",
  },
  {
    eyebrow: "Step 04",
    title: "Apply & Track",
    body: "Draft, review, and submit from the Applications queue. Every run is captured, so if something trips, it explains itself. The one-time setup below auto-installs everything the automation needs — Node.js, the worker's packages, and the browser engine (you'll see a system permission prompt for Node). CV PDF export needs LaTeX/xelatex, installed separately.",
    install: true,
  },
];

/**
 * First-run onboarding — an animated slideshow that appears once (gated on
 * localStorage) to walk a new user through the flow, ending with a button to
 * install the automation browser. Dismisses to the Command Center.
 */
export function OnboardingOverlay() {
  const [open, setOpen] = useState<boolean>(() => localStorage.getItem(SEEN_KEY) !== "1");
  const [i, setI] = useState(0);
  const [installing, setInstalling] = useState(false);
  const [installMsg, setInstallMsg] = useState<string | null>(null);
  const [latexInstalling, setLatexInstalling] = useState(false);
  const [latexMsg, setLatexMsg] = useState<string | null>(null);

  const close = useCallback(() => {
    localStorage.setItem(SEEN_KEY, "1");
    setOpen(false);
  }, []);

  const go = useCallback((n: number) => setI((c) => Math.max(0, Math.min(SLIDES.length - 1, c + n))), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go, close]);

  const install = useCallback(async () => {
    if (installing) return;
    setInstalling(true);
    setInstallMsg("Installing the automation browser… this can take a minute.");
    try {
      const out = await invokeStrict<string>("install_dependencies");
      setInstallMsg(`Done. ${out.split("\n").slice(-1)[0] || "Browser installed."}`);
    } catch (e) {
      setInstallMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
    }
  }, [installing]);

  const installLatex = useCallback(async () => {
    if (latexInstalling) return;
    setLatexInstalling(true);
    setLatexMsg("Installing LaTeX for CV PDF export… this is a larger download and can take a few minutes.");
    try {
      const out = await invokeStrict<string>("install_latex");
      setLatexMsg(out.split("\n").slice(-1)[0] || "LaTeX installed.");
    } catch (e) {
      setLatexMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLatexInstalling(false);
    }
  }, [latexInstalling]);

  if (!open) return null;
  const slide = SLIDES[i];
  const last = i === SLIDES.length - 1;

  return (
    <div className="onb" role="dialog" aria-modal="true" aria-label="Welcome to HireMeOps">
      <div className="onb__bg" aria-hidden="true" />
      <button className="onb__skip" type="button" onClick={close}>
        Skip
      </button>

      <div className="onb__stage">
        <div className="onb__card" key={i}>
          <span className="onb__eyebrow">{slide.eyebrow}</span>
          <h1 className="onb__title">{slide.title}</h1>
          <p className="onb__body">{slide.body}</p>

          {slide.showIcons && (
            <div className="onb__icons">
              {ICONS.map((src, n) => (
                <img key={n} src={src} alt="" style={{ animationDelay: `${0.5 + n * 0.08}s` }} />
              ))}
            </div>
          )}

          {slide.install && (
            <div className="onb__install">
              <button type="button" className="onb__btn onb__btn--ghost" onClick={() => void install()} disabled={installing}>
                {installing ? "Installing…" : "Install dependencies"}
              </button>
              {installMsg && <p className="onb__installmsg">{installMsg}</p>}

              <button
                type="button"
                className="onb__btn onb__btn--ghost onb__btn--latex"
                onClick={() => void installLatex()}
                disabled={latexInstalling}
                title="Larger download — only needed for CV PDF export"
              >
                {latexInstalling ? "Installing LaTeX…" : "Install LaTeX (CV PDFs)"}
              </button>
              <p className="onb__installmsg onb__installmsg--warn">
                ⚠ Larger download (a few hundred MB) — only needed to export CVs as PDF. Skip it otherwise.
              </p>
              {latexMsg && <p className="onb__installmsg">{latexMsg}</p>}
            </div>
          )}
        </div>
      </div>

      <div className="onb__nav">
        <button type="button" className="onb__arrow" onClick={() => go(-1)} disabled={i === 0} aria-label="Previous">
          ‹
        </button>
        <div className="onb__dots">
          {SLIDES.map((_, n) => (
            <button
              key={n}
              type="button"
              className={n === i ? "onb__dot is-active" : "onb__dot"}
              onClick={() => setI(n)}
              aria-label={`Slide ${n + 1}`}
            />
          ))}
        </div>
        {last ? (
          <button type="button" className="onb__btn" onClick={close}>
            Get started
          </button>
        ) : (
          <button type="button" className="onb__arrow" onClick={() => go(1)} aria-label="Next">
            ›
          </button>
        )}
      </div>
    </div>
  );
}
