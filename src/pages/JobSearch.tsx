import { useState, useEffect, useMemo } from "react";
import { invokeStrict, safeInvoke, errMessage } from "../lib/tauriInvoke";
import { Cancel01Icon, PlayIcon } from "@hugeicons/core-free-icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { JobStatus, SearchQueryInput } from "../types/domain";
import {
  useJobStore,
  runGoogleSearch,
  runLinkedInPostsSearch,
  runGmailApply,
  runCathoSearch,
  runInfojobsSearch,
  runGupySearch,
  runUpworkSearch,
  runFreelas99Search,
  cathoApply,
  infojobsApply,
  runIndeedSearch,
  startIndeedApply,
  confirmIndeedSubmit,
  rejectIndeedSubmit,
  draftApplication,
  submitApplication,
} from "../stores/useJobStore";
import linkedinIcon from "../assets/platform-icons/linkedin.png";
import cathoIcon from "../assets/platform-icons/catho.png";
import infojobsIcon from "../assets/platform-icons/infojobs.png";
import indeedIcon from "../assets/platform-icons/indeed.png";
import gupyIcon from "../assets/platform-icons/gupy.png";
import upworkIcon from "../assets/platform-icons/upwork.svg";
import freelas99Icon from "../assets/platform-icons/freelas99.svg";
import inhireIcon from "../assets/platform-icons/inhire.svg";
import googleIcon from "../assets/platform-icons/google.svg";
import { useJobFiltersStore } from "../stores/useJobFiltersStore";
import { useSearchQueryStore } from "../stores/useSearchQueryStore";
import { useProfileStore } from "../stores/useProfileStore";
import { useAutomationStore } from "../stores/useAutomationStore";
import { useJobPreferencesStore } from "../stores/useJobPreferencesStore";
import { ApplicationDraftModal } from "../components/ApplicationDraftModal";
import { JobCalibrationPanel } from "./jobsearch/JobCalibrationPanel";
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Field,
  Icon,
  Input,
  MatchScoreBadge,
  ScoreBar,
  Select,
  Switch,
  RadioGroup,
  Toolbar,
  ToolbarSep,
  ToolbarSpacer,
  jobStatusVariant,
  matchScoreVariant,
  humanizeStatus,
} from "../components/ui";

/* ── Constants ──────────────────────────────────────────────────── */

type FilterStatus = "all" | JobStatus;

// Lowercase + strip accents so "híbrido" matches "hibrido".
const normalizeText = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Work-mode synonyms (EN + PT) — typing "remote" should catch PT postings that
// say "remoto" / "home office", "hybrid" → "híbrido", etc. Keys and values are
// pre-normalized (accent-free). A query not in this map matches itself.
// Derive the selected work models from the calibration `remoteModes` preference.
// Was inlined per-platform and only ever emitted remote+hybrid — on-site jobs
// were never queried. Order is stable so per-model passes are deterministic.
export function workModelsFrom(remoteModes: string[]): string[] {
  const has = (...kws: string[]) =>
    remoteModes.some((m) => kws.some((k) => m.toLowerCase().includes(k)));
  const out: string[] = [];
  if (has("remote", "remoto", "home")) out.push("remote");
  if (has("hybrid", "hibrid", "híbr")) out.push("hybrid");
  if (has("onsite", "on-site", "presen", "local")) out.push("onsite");
  return out;
}

const WORK_MODE_SYNONYMS: Record<string, string[]> = {
  remote: ["remote", "remoto", "home office", "home-office", "teletrabalho", "a distancia"],
  remoto: ["remote", "remoto", "home office", "home-office", "teletrabalho", "a distancia"],
  hybrid: ["hybrid", "hibrido"],
  hibrido: ["hybrid", "hibrido"],
  onsite: ["onsite", "on-site", "presencial", "presential", "no local"],
  presencial: ["onsite", "on-site", "presencial", "presential", "no local"],
};

// Source-platform → favicon, so a job row shows at a glance where it came from
// ("oh, this one's LinkedIn"). Keyed on the stored lowercase `platform` string.
// `linkedin_post` reuses the LinkedIn mark; google-dork results carry the Google
// mark. `google` also covers inhire postings (they're surfaced via the dork).
const PLATFORM_ICONS: Record<string, string> = {
  linkedin: linkedinIcon,
  linkedin_post: linkedinIcon,
  google: googleIcon,
  catho: cathoIcon,
  infojobs: infojobsIcon,
  gupy: gupyIcon,
  indeed: indeedIcon,
  upwork: upworkIcon,
  "99freelas": freelas99Icon,
  inhire: inhireIcon,
};

// Friendly label for the icon's alt/title (falls back to the raw key).
const PLATFORM_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  linkedin_post: "LinkedIn post",
  google: "Google (dork)",
  catho: "Catho",
  infojobs: "InfoJobs",
  gupy: "Gupy",
  indeed: "Indeed",
  upwork: "Upwork",
  "99freelas": "99freelas",
  inhire: "inhire",
};


const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "discovered", label: "Discovered" },
  { value: "queued", label: "Queued" },
  { value: "matched", label: "Matched" },
  { value: "applied", label: "Applied" },
  { value: "needs_review", label: "Needs review" },
  { value: "failed", label: "Failed" },
];

/* ── Helpers ────────────────────────────────────────────────────── */

// Scans a job description for a recruiter-specified subject line.
// Matches Portuguese "Assunto: ..." or English "Subject: ..." (case-insensitive).
const ASSUNTO_RE = /(?:assunto|subject)\s*[:\-]\s*(.+)/i;

export function extractAssunto(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = ASSUNTO_RE.exec(text);
  if (!m) return null;
  return m[1].trim().slice(0, 120);
}

// Detect a contact phone in post text. Matches Brazilian forms: "(11) 91234-5678",
// "(11)1234-5678", and the bare dashed "91234-5678" / "1234-5678". The dash is the
// anchor for the bare form so plain digit runs (dates, ids) don't false-match.
const PHONE_RE = /\(\d{2}\)\s?9?\d{4}-?\d{4}|\b9?\d{4}-\d{4}\b/;

export function extractPhone(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = PHONE_RE.exec(text);
  return m ? m[0].trim() : null;
}

type ContactFilter = "all" | "email" | "phone" | "any";

const CONTACT_OPTIONS = [
  { value: "all", label: "Any" },
  { value: "email", label: "Has email" },
  { value: "phone", label: "Has phone" },
  { value: "any", label: "Has email or phone" },
];

/* ── Component ──────────────────────────────────────────────────── */

export function JobSearch() {
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [workModeFilter, setWorkModeFilter] = useState<"all" | "remote" | "hybrid" | "onsite">(
    "all",
  );
  const [platformFilter, setPlatformFilter] = useState("All");
  const [locationFilter, setLocationFilter] = useState("");
  // General keyword filter — every word must appear somewhere in the row.
  const [wordsFilter, setWordsFilter] = useState("");
  const [minScore, setMinScore] = useState<number | "">("");
  // All-in-one search: runs every platform in turn. Manual per-platform buttons
  // are hidden behind a toggle so the default surface is just "Search all".
  const [runningAll, setRunningAll] = useState(false);
  const [showManual, setShowManual] = useState(false);
  // Calibration bench (the former Job Preferences page) folds in here as a
  // togglable panel — the filters it edits already drive this page's searches.
  const [showPreferences, setShowPreferences] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftModalOpen, setDraftModalOpen] = useState(false);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);
  // id of the query currently being deleted — null when idle
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  // Indeed SmartApply is human-in-the-loop: after startIndeedApply the popup is
  // parked at the submit step, and the operator confirms or discards it here.
  const [indeedParked, setIndeedParked] = useState(false);
  // LinkedIn Easy Apply is human-in-the-loop too: after the engine fills +
  // AI-answers the form it parks at Submit (automation state "NeedsReview"); the
  // operator confirms or discards it here.
  const [linkedinParked, setLinkedinParked] = useState(false);
  const [hideDuplicates, setHideDuplicates] = useState(true);
  const [contactFilter, setContactFilter] = useState<ContactFilter>("all");
  // Skills the user picked to build search queries with. Seeded from job
  // preferences (filters.requiredSkills) and re-synced when those change.
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const filters = useJobFiltersStore((s) => s.filters);
  const {
    jobs,
    matches,
    isLoading,
    error,
    loadJobs,
    loadMatches,
    scoreJob,
    setJobStatus,
    runSearch,
    runLinkedInSearch,
    clearError,
  } = useJobStore();
  // Narrow selectors - useSearchQueryStore also carries `isLoading`, which
  // this page never reads; a whole-store subscription would re-render here
  // on every list-load toggle for no visible change.
  const isGenerating = useSearchQueryStore((s) => s.isGenerating);
  const searchError = useSearchQueryStore((s) => s.error);
  const savedQueries = useSearchQueryStore((s) => s.queries);
  const loadQueries = useSearchQueryStore((s) => s.load);
  const generateQueries = useSearchQueryStore((s) => s.generate);
  const removeQuery = useSearchQueryStore((s) => s.remove);
  const loadPreferences = useJobPreferencesStore((s) => s.load);
  const clearSearchError = useSearchQueryStore((s) => s.clearError);

  // Reload whenever the active profile changes.
  useEffect(() => {
    if (!activeProfileId) return;
    void loadJobs(activeProfileId);
    void loadMatches(activeProfileId);
    void loadQueries(activeProfileId);
    void loadPreferences(activeProfileId);
  }, [activeProfileId, loadJobs, loadMatches, loadQueries, loadPreferences]);

  // Default every preference skill to selected; re-seed when the preference
  // skill set changes (join key). User deselections persist until then.
  const skillsKey = filters.requiredSkills.join("|");
  useEffect(() => {
    setSelectedSkills(filters.requiredSkills);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillsKey]);

  // A parked Indeed popup belongs to the job it was started from; switching the
  // selection hides the confirm/discard buttons so they can't act on the wrong one.
  useEffect(() => {
    setIndeedParked(false);
    setLinkedinParked(false);
  }, [selectedId]);

  const toggleSkill = (skill: string) =>
    setSelectedSkills((prev) =>
      prev.includes(skill) ? prev.filter((s) => s !== skill) : [...prev, skill],
    );

  // Build the generator input from the shared job-filters working set. Returns
  // null when no profile is active. targetRoles must be non-empty for a
  // meaningful query - the button gating enforces that before we get here.
  const buildSearchInput = (): SearchQueryInput | null => {
    if (activeProfileId === null) return null;
    return {
      profileId: activeProfileId,
      titles: filters.targetRoles,
      // Only the skills the user ticked feed the query builder; empty selection
      // falls back to all preference skills so a search never goes skill-less.
      requiredSkills: selectedSkills.length > 0 ? selectedSkills : filters.requiredSkills,
      location: filters.locations[0] ?? null,
      remoteMode: filters.remoteModes[0]?.toLowerCase() ?? null,
      seniority: filters.seniority,
    };
  };

  // Always regenerate queries before searching — backend does DELETE+INSERT so
  // changing target roles picks up fresh queries instead of reusing stale ones.
  const handleRunSearch = async (
    platform:
      | "linkedin"
      | "google"
      | "posts"
      | "catho"
      | "infojobs"
      | "gupy"
      | "indeed"
      | "upwork"
      | "99freelas",
  ) => {
    if (activeProfileId === null) return;
    setSearchMsg(null);

    const input = buildSearchInput();
    if (input === null) return;

    const ids = await generateQueries(input);
    if (ids === null) return;

    const available = useSearchQueryStore.getState().queries;

    if (platform === "catho") {
      // Catho takes a plain role (not a boolean query) as the URL slug. Run one
      // scrape per target role (up to 3) and union the results — a single role
      // finds far fewer offers than the 2-3 roles the user actually wants. The
      // backend dedupes by canonical URL, so overlap between roles is free.
      // Group the ingested posts under the linkedin query so run_search() scores.
      const target = available.find((q) => q.platform === "linkedin" && q.enabled);
      const roles = filters.targetRoles.map((r) => r.trim()).filter(Boolean).slice(0, 3);
      if (roles.length === 0) {
        setSearchMsg("Set a target role in Job Preferences first.");
        return;
      }
      // Catho's URL takes a work_model[] array, so all selected modes (incl.
      // on-site) go in one pass; the builder maps onsite→presential.
      const workModels = workModelsFrom(filters.remoteModes);
      let totalIngested = 0;
      for (const role of roles) {
        setSearchMsg(`Searching Catho for "${role}"…`);
        try {
          const scraped = await runCathoSearch(
            activeProfileId,
            target?.id ?? null,
            role,
            undefined,
            workModels.length > 0 ? workModels : undefined,
            undefined,
            5,
          );
          totalIngested += scraped.ingested;
        } catch (e) {
          setSearchMsg(errMessage(e));
          return;
        }
      }
      const count = target ? await runSearch(target.id) : 0;
      setSearchMsg(
        `Scraped ${totalIngested} Catho job${totalIngested === 1 ? "" : "s"} across ${roles.length} keyword${roles.length === 1 ? "" : "s"} · ${count ?? 0} scored`,
      );
      await loadJobs(activeProfileId);
      await loadMatches(activeProfileId);
      return;
    }

    if (platform === "infojobs") {
      // InfoJobs takes a plain keyword (redirects to its SEO slug). Run one
      // scrape per target role (up to 3) and union — same reasoning as Catho.
      // maxPages 10 pages the infinite-scroll feed deep (≈200 offers, stops at
      // the real total). Location is skipped — InfoJobs filters by a numeric
      // `poblacion` id we can't resolve from a city name, so it's nationwide.
      const target = available.find((q) => q.platform === "linkedin" && q.enabled);
      const roles = filters.targetRoles.map((r) => r.trim()).filter(Boolean).slice(0, 3);
      if (roles.length === 0) {
        setSearchMsg("Set a target role in Job Preferences first.");
        return;
      }
      // InfoJobs' `idw` is a single value, so run one pass PER selected work mode
      // (LO: "run queries per each"). No mode selected → one unfiltered pass.
      const workModes = workModelsFrom(filters.remoteModes);
      const modePasses: (string[] | undefined)[] =
        workModes.length > 0 ? workModes.map((m) => [m]) : [undefined];
      let totalIngested = 0;
      for (const wm of modePasses) {
        for (const role of roles) {
          setSearchMsg(`Searching InfoJobs for "${role}"${wm ? ` (${wm[0]})` : ""}…`);
          try {
            const scraped = await runInfojobsSearch(
              activeProfileId,
              target?.id ?? null,
              role,
              undefined,
              wm,
              undefined,
              10,
            );
            totalIngested += scraped.ingested;
          } catch (e) {
            setSearchMsg(errMessage(e));
            return;
          }
        }
      }
      const count = target ? await runSearch(target.id) : 0;
      setSearchMsg(
        `Scraped ${totalIngested} InfoJobs job${totalIngested === 1 ? "" : "s"} across ${roles.length} keyword${roles.length === 1 ? "" : "s"} · ${count ?? 0} scored`,
      );
      await loadJobs(activeProfileId);
      await loadMatches(activeProfileId);
      return;
    }

    if (platform === "gupy") {
      // Gupy portal takes a plain keyword in the URL path. Run one scrape per
      // target role (up to 3) and union — same reasoning as Catho/InfoJobs.
      // `remoteOnly` maps to the workplaceTypes[]=remote filter.
      const target = available.find((q) => q.platform === "linkedin" && q.enabled);
      const roles = filters.targetRoles.map((r) => r.trim()).filter(Boolean).slice(0, 3);
      if (roles.length === 0) {
        setSearchMsg("Set a target role in Job Preferences first.");
        return;
      }
      const remoteOnly = filters.remoteModes.some((m) => m.toLowerCase().includes("remote"));
      let totalIngested = 0;
      for (const role of roles) {
        setSearchMsg(`Searching Gupy for "${role}"…`);
        try {
          const scraped = await runGupySearch(activeProfileId, target?.id ?? null, role, remoteOnly, 8);
          totalIngested += scraped.ingested;
        } catch (e) {
          setSearchMsg(errMessage(e));
          return;
        }
      }
      const count = target ? await runSearch(target.id) : 0;
      setSearchMsg(
        `Scraped ${totalIngested} Gupy job${totalIngested === 1 ? "" : "s"} across ${roles.length} keyword${roles.length === 1 ? "" : "s"} · ${count ?? 0} scored`,
      );
      await loadJobs(activeProfileId);
      await loadMatches(activeProfileId);
      return;
    }

    if (platform === "upwork") {
      // Upwork takes a plain keyword. Run one scrape per target role (up to 3)
      // and union — same reasoning as Catho/InfoJobs/Gupy. View-only (no apply);
      // sorted newest-first. Freelance work is remote by nature, so work-mode
      // filters don't apply here.
      const target = available.find((q) => q.platform === "linkedin" && q.enabled);
      const roles = filters.targetRoles.map((r) => r.trim()).filter(Boolean).slice(0, 3);
      if (roles.length === 0) {
        setSearchMsg("Set a target role in Job Preferences first.");
        return;
      }
      let totalIngested = 0;
      for (const role of roles) {
        setSearchMsg(`Searching Upwork for "${role}"…`);
        try {
          const scraped = await runUpworkSearch(activeProfileId, target?.id ?? null, role, "recency", 3);
          totalIngested += scraped.ingested;
        } catch (e) {
          setSearchMsg(errMessage(e));
          return;
        }
      }
      const count = target ? await runSearch(target.id) : 0;
      setSearchMsg(
        `Scraped ${totalIngested} Upwork job${totalIngested === 1 ? "" : "s"} across ${roles.length} keyword${roles.length === 1 ? "" : "s"} · ${count ?? 0} scored`,
      );
      await loadJobs(activeProfileId);
      await loadMatches(activeProfileId);
      return;
    }

    if (platform === "99freelas") {
      // 99freelas (Brazilian freelance marketplace) takes a plain keyword. One
      // scrape per target role (up to 3), union. View-only. Server-rendered, so
      // no anti-bot dance — just a fast scrape.
      const target = available.find((q) => q.platform === "linkedin" && q.enabled);
      const roles = filters.targetRoles.map((r) => r.trim()).filter(Boolean).slice(0, 3);
      if (roles.length === 0) {
        setSearchMsg("Set a target role in Job Preferences first.");
        return;
      }
      let totalIngested = 0;
      for (const role of roles) {
        setSearchMsg(`Searching 99freelas for "${role}"…`);
        try {
          const scraped = await runFreelas99Search(activeProfileId, target?.id ?? null, role, 3);
          totalIngested += scraped.ingested;
        } catch (e) {
          setSearchMsg(errMessage(e));
          return;
        }
      }
      const count = target ? await runSearch(target.id) : 0;
      setSearchMsg(
        `Scraped ${totalIngested} 99freelas project${totalIngested === 1 ? "" : "s"} across ${roles.length} keyword${roles.length === 1 ? "" : "s"} · ${count ?? 0} scored`,
      );
      await loadJobs(activeProfileId);
      await loadMatches(activeProfileId);
      return;
    }

    if (platform === "indeed") {
      // Indeed takes plain keywords (not a boolean query); group ingested posts
      // under the linkedin query so run_search() scores them, same as Catho.
      // Run one full search per target role (up to 3) and union — same as the
      // Hiring-posts / Catho / InfoJobs / Gupy flows. When remote is preferred,
      // the worker itself unions two remote passes (sc attr + l=Remoto).
      const target = available.find((q) => q.platform === "linkedin" && q.enabled);
      const roles = filters.targetRoles.map((r) => r.trim()).filter(Boolean).slice(0, 3);
      if (roles.length === 0) {
        setSearchMsg("Set a target role in Job Preferences first.");
        return;
      }
      const remote = filters.remoteModes.some((m) => m.toLowerCase().includes("remote"));
      const country = filters.locations[0];
      let totalIngested = 0;
      for (const role of roles) {
        setSearchMsg(`Searching Indeed for "${role}"…`);
        try {
          const scraped = await runIndeedSearch(
            activeProfileId,
            target?.id ?? null,
            role,
            country,
            remote,
            3,
          );
          totalIngested += scraped.ingested;
        } catch (e) {
          setSearchMsg(errMessage(e));
          return;
        }
      }
      const count = target ? await runSearch(target.id) : 0;
      setSearchMsg(
        `Scraped ${totalIngested} Indeed job${totalIngested === 1 ? "" : "s"} across ${roles.length} keyword${roles.length === 1 ? "" : "s"} · ${count ?? 0} scored`,
      );
      await loadJobs(activeProfileId);
      await loadMatches(activeProfileId);
      return;
    }

    if (platform === "posts") {
      const target = available.find((q) => q.platform === "linkedin_post" && q.enabled);
      if (target === undefined) {
        setSearchMsg("No hiring-posts query available.");
        return;
      }
      let scraped: Awaited<ReturnType<typeof runLinkedInPostsSearch>>;
      try {
        scraped = await runLinkedInPostsSearch(activeProfileId, target.id, target.query);
      } catch (e) {
        setSearchMsg(errMessage(e));
        return;
      }
      const count = await runSearch(target.id);
      setSearchMsg(
        `Scraped ${scraped.ingested} hiring post${scraped.ingested === 1 ? "" : "s"} across ${scraped.pagesScraped} page${scraped.pagesScraped === 1 ? "" : "s"} · ${count ?? 0} scored`,
      );
      await loadJobs(activeProfileId);
      await loadMatches(activeProfileId);
      return;
    }

    const target = available.find((q) => q.platform === platform && q.enabled);
    if (target === undefined) {
      setSearchMsg(`No ${platform} query available.`);
      return;
    }

    if (platform === "linkedin") {
      // LinkedIn keyword search only honours ONE boolean AND. The stored
      // target.query is a mega-clause — `(roles) AND (skills) AND remote AND
      // NOT(...)` — with several ANDs, which LinkedIn silently returns ZERO
      // results for. So instead we run one SEPARATE single-AND query per
      // role×skill pair — `"Desenvolvedor" AND "Java"`, `"Desenvolvedor" AND
      // "Back-End"`, … — plus a role-only query when there are no skills. Each is
      // a clean 2-term search that actually returns hits; the backend dedupes by
      // canonical URL so overlap between pairs is free. `remote` stays a FILTER
      // (f_WT=2), never a keyword term. Grouped under target.id so run_search
      // scores them. Capped so roles×skills×countries×pages can't explode.
      const countries: (string | null)[] =
        filters.locations.length > 0 ? filters.locations : [null];
      const remote = filters.remoteModes.some((m) => m.toLowerCase().includes("remote"));
      const roles = filters.targetRoles.map((r) => r.trim()).filter(Boolean).slice(0, 3);
      const skills = (selectedSkills.length > 0 ? selectedSkills : filters.requiredSkills)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 4);
      if (roles.length === 0) {
        setSearchMsg("Set a target role in Job Preferences first.");
        return;
      }
      const pairQueries: string[] = [];
      for (const role of roles) {
        if (skills.length === 0) {
          pairQueries.push(`"${role}"`);
        } else {
          for (const skill of skills) pairQueries.push(`"${role}" AND "${skill}"`);
        }
      }
      const capped = pairQueries.slice(0, 8);
      let totalIngested = 0;
      let totalPages = 0;
      for (const country of countries) {
        for (const q of capped) {
          setSearchMsg(`Searching LinkedIn: ${q}${country ? ` · ${country}` : ""}…`);
          const scraped = await runLinkedInSearch(activeProfileId, target.id, q, country, remote);
          if (scraped === null) return;
          totalIngested += scraped.ingested;
          totalPages += scraped.pagesScraped;
        }
      }
      const count = await runSearch(target.id);
      const countriesSuffix = countries.length > 1 ? ` in ${countries.length} countries` : "";
      setSearchMsg(
        `Scraped ${totalIngested} new job${totalIngested === 1 ? "" : "s"} across ${capped.length} keyword combo${capped.length === 1 ? "" : "s"}${countriesSuffix} · ${count ?? 0} scored against your CV.`,
      );
    } else {
      // Google dork — throws when blocked (captcha wall) so we catch locally
      // and show the error in the toolbar status span, not the store banner.
      let scraped;
      try {
        scraped = await runGoogleSearch(activeProfileId, target.id, target.query);
      } catch (e) {
        setSearchMsg(errMessage(e));
        return;
      }
      if (scraped.blocked) {
        setSearchMsg("Google blocked the request — try again later or solve the captcha.");
        return;
      }
      const count = await runSearch(target.id);
      setSearchMsg(
        `Scraped ${scraped.ingested} Google result${scraped.ingested === 1 ? "" : "s"} across ${scraped.pagesScraped} page${scraped.pagesScraped === 1 ? "" : "s"} · ${count ?? 0} scored`,
      );
    }

    await loadJobs(activeProfileId);
    await loadMatches(activeProfileId);
  };


  // All-in-one: run every platform search in turn, aggregating into one message.
  const handleRunAll = async () => {
    if (activeProfileId === null || runningAll) return;
    setRunningAll(true);
    const platforms = [
      "linkedin",
      "google",
      "posts",
      "catho",
      "infojobs",
      "gupy",
      "indeed",
      "upwork",
      "99freelas",
    ] as const;
    let done = 0;
    for (const p of platforms) {
      setSearchMsg(`Running searches… (${done}/${platforms.length}) — ${p}`);
      try {
        await handleRunSearch(p);
      } catch {
        /* keep going — one platform failing shouldn't abort the rest */
      }
      done += 1;
    }
    setSearchMsg(`All ${platforms.length} searches finished.`);
    setRunningAll(false);
  };

  const canSearch =
    activeProfileId !== null && !isLoading && !isGenerating && filters.targetRoles.length > 0;

  const searchDisabledTitle =
    activeProfileId === null
      ? "Select a profile first"
      : filters.targetRoles.length === 0
        ? "Set target roles in Job Preferences first"
        : undefined;

  const bannerError = error ?? searchError;
  const dismissError = () => {
    clearError();
    clearSearchError();
  };

  // Index matches by jobId once for O(1) lookup instead of an Array.find scan
  // per job, per render (filter, list badges, and detail pane all query it).
  const scoreByJobId = useMemo(() => {
    const m = new Map<string, number>();
    for (const match of matches) m.set(match.jobId, Math.round(match.score));
    return m;
  }, [matches]);

  const matchScoreFor = (jobId: string): number | null => scoreByJobId.get(jobId) ?? null;

  // Platform options built from the platforms actually present, so the filter
  // value matches the stored (lowercase) j.platform exactly — a fixed
  // capitalized list silently matched nothing and omitted catho/indeed.
  const platformOptions = useMemo(() => {
    const present = [...new Set(jobs.map((j) => j.platform).filter(Boolean))].sort();
    return [
      { value: "All", label: "All" },
      ...present.map((p) => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) })),
    ];
  }, [jobs]);

  const filtered = useMemo(
    () =>
      jobs.filter((j) => {
        // Hide re-scrape duplicates the ingest layer already flagged.
        if (hideDuplicates && j.status === "skipped_duplicate_url") return false;
        const matchStatus = statusFilter === "all" || j.status === statusFilter;
        const matchPlatform = platformFilter === "All" || j.platform === platformFilter;
        if (!matchStatus || !matchPlatform) return false;
        // Work-mode quick filter: match the classified remote_mode, falling back
        // to the posting text (title/location/description) via the synonym map so
        // old rows with a null remote_mode still filter correctly.
        if (workModeFilter !== "all") {
          const hay = normalizeText(
            `${j.remoteMode ?? ""} ${j.location ?? ""} ${j.title} ${j.description ?? ""}`,
          );
          const terms = WORK_MODE_SYNONYMS[workModeFilter] ?? [workModeFilter];
          if (!terms.some((t) => hay.includes(t))) return false;
        }
        // General words gate: accent-insensitive AND-match — every typed word must
        // appear somewhere in the row (title/company/location/description/platform).
        const words = normalizeText(wordsFilter.trim());
        if (words !== "") {
          const hay = normalizeText(
            `${j.title} ${j.company} ${j.location ?? ""} ${j.description ?? ""} ${j.platform}`,
          );
          if (!words.split(/\s+/).every((t) => t === "" || hay.includes(t))) return false;
        }
        // Location gate: accent-insensitive substring across location + remote
        // mode + title + description. Work-mode words expand to EN+PT synonyms,
        // so "remote" catches PT "remoto"/"home office" and "hybrid" → "híbrido".
        const loc = normalizeText(locationFilter.trim());
        if (loc !== "") {
          const hay = normalizeText(
            `${j.location ?? ""} ${j.remoteMode ?? ""} ${j.title} ${j.description ?? ""}`,
          );
          const terms = WORK_MODE_SYNONYMS[loc] ?? [loc];
          if (!terms.some((t) => hay.includes(t))) return false;
        }
        // Contact gate: email comes from the stored contactEmail; phone is
        // sniffed live from the post text since we don't persist it.
        if (contactFilter !== "all") {
          const hasEmail = j.contactEmail != null && j.contactEmail !== "";
          const hasPhone = extractPhone(j.description) !== null;
          if (contactFilter === "email" && !hasEmail) return false;
          if (contactFilter === "phone" && !hasPhone) return false;
          if (contactFilter === "any" && !hasEmail && !hasPhone) return false;
        }
        // Min-score gate: only applied when the user set a threshold. Unscored jobs
        // (score === null) fall through so the operator can still see and score
        // them; hiding them would misleadingly imply they were rejected.
        if (typeof minScore === "number" && minScore > 0) {
          const s = scoreByJobId.get(j.id) ?? null;
          if (s !== null && s < minScore) return false;
        }
        return true;
      }),
    [
      jobs,
      hideDuplicates,
      statusFilter,
      workModeFilter,
      platformFilter,
      locationFilter,
      wordsFilter,
      minScore,
      contactFilter,
      scoreByJobId,
    ],
  );

  // ponytail: inline count, no memo — job list is small and this only renders when hideDuplicates is on
  const hiddenDupeCount = hideDuplicates
    ? jobs.filter((j) => j.status === "skipped_duplicate_url").length
    : 0;

  const selected = jobs.find((j) => j.id === selectedId) ?? null;
  const selectedMatchScore = selected !== null ? matchScoreFor(selected.id) : null;
  const selectedMatchId =
    selected !== null ? (matches.find((m) => m.jobId === selected.id)?.id ?? null) : null;
  // Full match row for the selected job (used for score breakdown).
  const selectedMatch =
    selected !== null ? (matches.find((m) => m.jobId === selected.id) ?? null) : null;

  const handleScoreSelected = async () => {
    if (selectedId === null || activeProfileId === null) return;
    await scoreJob(selectedId, activeProfileId);
  };

  const handleQueueSelected = async () => {
    if (selectedId === null) return;
    await setJobStatus(selectedId, "queued");
  };

  const handleQueueDetail = async () => {
    if (selected === null) return;
    await setJobStatus(selected.id, "queued");
  };

  // Auto-queue every fresh job in the current view — statuses that haven't been
  // acted on yet, never duplicates (skipped_duplicate_url), already-queued, or
  // terminal (applied/ignored/rejected). Lets the user queue a whole search
  // pass in one click instead of job-by-job.
  const handleQueueAll = async () => {
    if (activeProfileId === null) return;
    const QUEUEABLE = new Set(["discovered", "matched", "needs_review", "saved"]);
    const toQueue = filtered.filter(
      (j) => j.status !== "skipped_duplicate_url" && QUEUEABLE.has(j.status),
    );
    if (toQueue.length === 0) {
      setSearchMsg("No new jobs to queue.");
      return;
    }
    setSearchMsg(`Queuing ${toQueue.length} job${toQueue.length === 1 ? "" : "s"}…`);
    for (const j of toQueue) await setJobStatus(j.id, "queued");
    await loadJobs(activeProfileId);
    setSearchMsg(`Queued ${toQueue.length} job${toQueue.length === 1 ? "" : "s"}.`);
  };

  // Auto-apply: drain the QUEUED jobs across ALL platforms, each via its native
  // submit path. Catho/InfoJobs are one-shot per offer; Indeed fills the
  // SmartApply popup then confirms it; LinkedIn enqueues each scored match into
  // the automation engine, runs it, and auto-confirms every parked ("NeedsReview")
  // submit until the queue drains. Real applications — hence the up-front confirm.
  // Marks each applied / needs_review / failed so a re-run skips the done ones.
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const handleAutoApply = async () => {
    if (activeProfileId === null || isApplying) return;
    const queued = jobs.filter((j) => j.status === "queued");
    const direct = queued.filter((j) => j.platform === "catho" || j.platform === "infojobs");
    const indeed = queued.filter((j) => j.platform === "indeed");
    const linkedin = queued.filter((j) => j.platform === "linkedin");
    const total = direct.length + indeed.length + linkedin.length;
    if (total === 0) {
      setSearchMsg("No queued jobs to auto-apply.");
      return;
    }
    if (
      !window.confirm(
        `Auto-apply to ${total} queued job${total === 1 ? "" : "s"}? Each submits a REAL application in a visible window (Catho/InfoJobs/Indeed one-shot; LinkedIn Easy Apply is filled and auto-confirmed).`,
      )
    )
      return;

    setIsApplying(true);
    let applied = 0;
    let attention = 0;
    try {
      // 1. Catho + InfoJobs — one-shot per offer.
      for (let i = 0; i < direct.length; i++) {
        const j = direct[i];
        setSearchMsg(`Auto-applying (${j.platform}) ${i + 1}/${direct.length}: "${j.title}"…`);
        try {
          const res =
            j.platform === "catho"
              ? await cathoApply(activeProfileId, j.id, j.url)
              : await infojobsApply(activeProfileId, j.id, j.url);
          if (["applied", "submitted", "already_applied"].includes(res.status)) {
            await setJobStatus(j.id, "applied");
            applied++;
          } else {
            await setJobStatus(j.id, "needs_review");
            attention++;
          }
        } catch {
          await setJobStatus(j.id, "failed");
          attention++;
        }
      }

      // 2. Indeed — start SmartApply (auto-answers the known question buckets),
      // then confirm the parked submit. Free-text/unknown questions throw → the
      // job is left for review.
      for (let i = 0; i < indeed.length; i++) {
        const j = indeed[i];
        setSearchMsg(`Auto-applying (indeed) ${i + 1}/${indeed.length}: "${j.title}"…`);
        try {
          await startIndeedApply(j.url, activeProfileId);
          await confirmIndeedSubmit();
          await setJobStatus(j.id, "applied");
          applied++;
        } catch {
          await setJobStatus(j.id, "needs_review");
          attention++;
        }
      }

      // 3. LinkedIn — enqueue each scored match (draft → submit), run the engine,
      // and auto-confirm each parked submit. The engine sets the job status
      // itself (update_application_outcome), so we don't setJobStatus here.
      if (linkedin.length) {
        let enq = 0;
        for (const j of linkedin) {
          const matchId = matches.find((m) => m.jobId === j.id)?.id;
          if (matchId === undefined) {
            await setJobStatus(j.id, "needs_review"); // score it first to draft
            attention++;
            continue;
          }
          try {
            const draftId = await draftApplication(matchId);
            await submitApplication(draftId);
            enq++;
          } catch {
            await setJobStatus(j.id, "failed");
            attention++;
          }
        }
        if (enq > 0) {
          setSearchMsg(`Running LinkedIn Easy Apply for ${enq} job${enq === 1 ? "" : "s"}…`);
          const auto = useAutomationStore.getState();
          await auto.start();
          // Auto-confirm each park until the queue reaches a terminal state.
          const deadline = Date.now() + 15 * 60 * 1000;
          for (;;) {
            await sleep(2500);
            const st = useAutomationStore.getState().state;
            if (st === "NeedsReview") {
              await useAutomationStore.getState().confirmSubmit();
              applied++;
              await sleep(1500); // let the engine advance to the next task
            } else if (st === "Completed" || st === "Failed" || st === "Stopped") {
              break;
            }
            if (Date.now() > deadline) break;
          }
        }
      }
    } finally {
      setIsApplying(false);
      await loadJobs(activeProfileId);
      await loadMatches(activeProfileId);
    }
    setSearchMsg(`Auto-apply done · ${applied} applied · ${attention} need attention.`);
  };

  // Apply to the selected LinkedIn job: draft the application from its scored
  // match, queue it, run the engine (which fills + AI-answers the Easy Apply
  // form and parks at Submit), then surface the inline Submit/Discard controls.
  // Never auto-submits — the operator confirms below.
  const handleApplyLinkedIn = async () => {
    if (selected === null || activeProfileId === null || isApplying) return;
    const matchId = matches.find((m) => m.jobId === selected.id)?.id;
    if (matchId === undefined) {
      setSearchMsg("Score this job first — the application is drafted from its match.");
      return;
    }
    setIsApplying(true);
    try {
      const draftId = await draftApplication(matchId);
      await submitApplication(draftId);
      await useAutomationStore.getState().start();
      // Wait for the engine to fill + AI-answer + park (or finish/fail).
      const deadline = Date.now() + 5 * 60 * 1000;
      for (;;) {
        await sleep(2500);
        const st = useAutomationStore.getState().state;
        if (st === "NeedsReview") {
          setLinkedinParked(true);
          setSearchMsg(
            `Easy Apply form filled & AI-answered for "${selected.title}" — review it in the window, then submit or discard.`,
          );
          break;
        }
        if (st === "Completed" || st === "Failed" || st === "Stopped") {
          setSearchMsg(`LinkedIn apply: ${st.toLowerCase()} (check Applications if unexpected).`);
          break;
        }
        if (Date.now() > deadline) {
          setSearchMsg("LinkedIn apply timed out — check the Applications queue.");
          break;
        }
      }
      await loadJobs(activeProfileId);
      await loadMatches(activeProfileId);
    } catch (e) {
      setSearchMsg(errMessage(e));
    } finally {
      setIsApplying(false);
    }
  };

  const handleSkipSelected = async () => {
    if (selected === null) return;
    await setJobStatus(selected.id, "ignored");
  };

  const handleOpenSelected = async () => {
    if (selected === null) return;
    try {
      await openUrl(selected.url);
    } catch (e) {
      setSearchMsg(`Could not open job URL: ${String(e)}`);
    }
  };

  const handleRemoveQuery = async (id: string) => {
    setRemovingId(id);
    await removeQuery(id);
    setRemovingId(null);
  };

  const handleDeleteOldScans = async () => {
    if (activeProfileId === null) return;
    if (!window.confirm("Delete ALL scan results not yet applied to? This cannot be undone."))
      return;
    try {
      const deleted = await invokeStrict<number>("delete_old_scans", {
        profileId: activeProfileId,
        daysOld: 0,
      });
      await loadJobs(activeProfileId);
      await loadMatches(activeProfileId);
      setSearchMsg(`Deleted ${deleted} stale job${deleted === 1 ? "" : "s"}.`);
    } catch (e) {
      setSearchMsg(`Delete failed: ${errMessage(e)}`);
    }
  };

  return (
    <div className="page page--fill">
      {/* Error banner */}
      {bannerError !== null && (
        <div className="banner banner--error" role="alert">
          <span>{bannerError}</span>
          <Button size="sm" onClick={dismissError} aria-label="Dismiss error">
            <Icon icon={Cancel01Icon} size={14} />
          </Button>
        </div>
      )}

      {/* Toolbar */}
      {/* Per-site login buttons removed — the Command Center's Universal Login
          opens every site (and ChatGPT) in one window. */}
      <Toolbar border>
        <Button
          variant="primary"
          disabled={!canSearch || runningAll}
          title={searchDisabledTitle}
          icon={isGenerating || runningAll ? undefined : <Icon icon={PlayIcon} size={14} />}
          onClick={() => void handleRunAll()}
        >
          {runningAll ? "Searching all…" : isGenerating ? "Generating…" : "Search all"}
        </Button>
        <Button
          size="sm"
          onClick={() => setShowManual((v) => !v)}
          title="Run one platform at a time"
        >
          {showManual ? "Hide manual searches" : "Manual searches"}
        </Button>
        <Button
          size="sm"
          onClick={() => setShowPreferences((v) => !v)}
          title="Target roles, skills, filters that drive search & scoring"
        >
          {showPreferences ? "Hide preferences" : "Preferences"}
        </Button>
        {showManual && (
          <>
            <ToolbarSep />
            <Button
              size="sm"
              disabled={!canSearch}
              title={searchDisabledTitle}
              onClick={() => handleRunSearch("linkedin")}
            >
              LinkedIn
            </Button>
            <Button
              size="sm"
              disabled={!canSearch}
              title={searchDisabledTitle}
              onClick={() => handleRunSearch("google")}
            >
              Google Dork
            </Button>
            <Button
              size="sm"
              disabled={!canSearch}
              title={searchDisabledTitle}
              onClick={() => void handleRunSearch("posts")}
            >
              Hiring posts
            </Button>
            <Button
              size="sm"
              disabled={!canSearch}
              title={searchDisabledTitle}
              onClick={() => void handleRunSearch("catho")}
            >
              Catho
            </Button>
            <Button
              size="sm"
              disabled={!canSearch}
              title={searchDisabledTitle}
              onClick={() => void handleRunSearch("infojobs")}
            >
              InfoJobs
            </Button>
            <Button
              size="sm"
              disabled={!canSearch}
              title={searchDisabledTitle}
              onClick={() => void handleRunSearch("gupy")}
            >
              Gupy
            </Button>
            <Button
              size="sm"
              disabled={!canSearch}
              title={searchDisabledTitle}
              onClick={() => void handleRunSearch("indeed")}
            >
              Indeed
            </Button>
            <Button
              size="sm"
              disabled={!canSearch}
              title={searchDisabledTitle}
              onClick={() => void handleRunSearch("upwork")}
            >
              Upwork
            </Button>
            <Button
              size="sm"
              disabled={!canSearch}
              title={searchDisabledTitle}
              onClick={() => void handleRunSearch("99freelas")}
            >
              99freelas
            </Button>
          </>
        )}
        <ToolbarSep />
        <Button
          disabled={activeProfileId === null}
          title={activeProfileId === null ? "Select a profile first" : undefined}
          onClick={() => void handleDeleteOldScans()}
        >
          Delete old scans
        </Button>
        <ToolbarSep />
        <Button
          disabled={selectedId === null || activeProfileId === null || isLoading}
          onClick={handleScoreSelected}
        >
          Score Selected
        </Button>
        <Button disabled={selectedId === null || isLoading} onClick={handleQueueSelected}>
          Queue Selected
        </Button>
        <Button
          disabled={activeProfileId === null || isLoading}
          title="Queue every fresh (non-duplicate) job in this view"
          onClick={() => void handleQueueAll()}
        >
          Queue all
        </Button>
        <Button disabled={selectedId === null || isLoading} onClick={handleSkipSelected}>
          Skip
        </Button>
        <ToolbarSep />
        <Button
          variant="primary"
          disabled={activeProfileId === null || isApplying}
          title="Submit an application to every queued job — Catho, InfoJobs, Indeed, LinkedIn (visible windows)"
          onClick={() => void handleAutoApply()}
        >
          {isApplying ? "Auto-applying…" : "Auto-apply all"}
        </Button>
        <ToolbarSep />
        <Switch checked={hideDuplicates} onChange={setHideDuplicates}>
          Hide duplicates{hiddenDupeCount > 0 ? ` (${hiddenDupeCount} hidden)` : ""}
        </Switch>
        <ToolbarSpacer />
        {searchMsg !== null && (
          <span
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--color-text-2)",
            }}
          >
            {searchMsg}
          </span>
        )}
        {isLoading && (
          <span
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--color-text-muted)",
            }}
          >
            Loading...
          </span>
        )}
        <span
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--color-text-muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {filtered.length} / {jobs.length} jobs
        </span>
      </Toolbar>

      {/* Calibration bench (former Job Preferences) — shown in place of the
          results when toggled. Editing here updates the shared filters store
          that this page's searches + scoring read. */}
      {showPreferences && (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <JobCalibrationPanel />
        </div>
      )}

      {/* Three-pane */}
      <div className="three-pane" hidden={showPreferences}>
        {/* ── Filters panel ──────────────────────────────────────── */}
        <div className="three-pane__panel">
          <div className="panel-header">
            <h2 className="panel-header__title">Filters</h2>
          </div>
          <div className="section-group" style={{ padding: "var(--sp-3)" }}>
            <Field label="Platform">
              <Select
                value={platformFilter}
                options={platformOptions}
                onChange={(e) => setPlatformFilter(e.target.value)}
              />
            </Field>

            <Field label="Keywords" helper="Every word must appear in the job. Blank shows all.">
              <Input
                value={wordsFilter}
                onChange={(e) => setWordsFilter(e.target.value)}
                placeholder="e.g. react java remote"
              />
            </Field>

            <Field
              label="Location"
              helper="City, region, or 'remote'/'hybrid'. Blank shows all."
            >
              <Input
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
                placeholder="e.g. São Paulo, Remote"
              />
            </Field>

            <Field label="Status">
              <RadioGroup
                name="status-filter"
                value={statusFilter}
                options={STATUS_OPTIONS}
                onChange={(v) => setStatusFilter(v as FilterStatus)}
                label="Filter by status"
              />
            </Field>

            <Field label="Work mode">
              <RadioGroup
                name="work-mode-filter"
                value={workModeFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "remote", label: "Remote" },
                  { value: "hybrid", label: "Hybrid" },
                  { value: "onsite", label: "On-site" },
                ]}
                onChange={(v) => setWorkModeFilter(v as "all" | "remote" | "hybrid" | "onsite")}
                label="Filter by work mode"
              />
            </Field>

            <Field label="Min match score" helper="0 - 100. Blank shows every job.">
              <Input
                type="number"
                min={0}
                max={100}
                step={5}
                value={minScore}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") {
                    setMinScore("");
                    return;
                  }
                  const n = Number(raw);
                  if (Number.isFinite(n)) {
                    setMinScore(Math.max(0, Math.min(100, n)));
                  }
                }}
                placeholder="0"
              />
            </Field>

            <Field label="Contact" helper="Show only posts exposing a way to apply directly.">
              <RadioGroup
                name="contact-filter"
                value={contactFilter}
                options={CONTACT_OPTIONS}
                onChange={(v) => setContactFilter(v as ContactFilter)}
                label="Filter by contact"
              />
            </Field>

            {filters.requiredSkills.length > 0 && (
              <Field
                label="Skills in search"
                helper="Ticked skills stack into the hiring-posts query."
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
                  {filters.requiredSkills.map((skill) => (
                    <Checkbox
                      key={skill}
                      checked={selectedSkills.includes(skill)}
                      onChange={() => toggleSkill(skill)}
                    >
                      {skill}
                    </Checkbox>
                  ))}
                </div>
              </Field>
            )}

            {savedQueries.length > 0 && (
              <Field label="Saved queries">
                <ul
                  style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--sp-1)",
                  }}
                >
                  {savedQueries.map((q) => (
                    <li
                      key={q.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--sp-2)",
                      }}
                    >
                      <span
                        style={{
                          flex: 1,
                          fontSize: "var(--text-xs)",
                          color: "var(--color-text-2)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontFamily: "var(--font-mono)",
                        }}
                        title={`${q.platform}: ${q.query}`}
                      >
                        {q.platform}: {q.query}
                      </span>
                      <Button
                        size="sm"
                        disabled={removingId !== null}
                        onClick={() => void handleRemoveQuery(q.id)}
                        aria-label={`Remove ${q.platform} query`}
                      >
                        <Icon icon={Cancel01Icon} size={12} />
                      </Button>
                    </li>
                  ))}
                </ul>
              </Field>
            )}
          </div>
        </div>

        {/* ── Job list ────────────────────────────────────────────── */}
        <div className="three-pane__panel">
          <div className="panel-header">
            <h2 className="panel-header__title">Jobs</h2>
            <Badge variant="neutral">{filtered.length}</Badge>
          </div>

          {activeProfileId === null ? (
            <EmptyState
              label="Profile"
              title="No profile selected"
              body="Select a profile to load jobs."
            />
          ) : isLoading ? (
            <EmptyState title="Loading..." />
          ) : filtered.length === 0 ? (
            <EmptyState
              label="Empty"
              title="No jobs match"
              body="Adjust filters or run a search."
            />
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {filtered.map((job) => {
                const score = matchScoreFor(job.id);
                return (
                  <li
                    key={job.id}
                    className={selectedId === job.id ? "list-item selected" : "list-item"}
                    onClick={() => setSelectedId(job.id)}
                    tabIndex={0}
                    role="button"
                    aria-pressed={selectedId === job.id}
                    onKeyDown={(e) => e.key === "Enter" && setSelectedId(job.id)}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--sp-2)",
                        minWidth: 0,
                      }}
                    >
                      {PLATFORM_ICONS[job.platform] && (
                        <img
                          src={PLATFORM_ICONS[job.platform]}
                          alt={PLATFORM_LABELS[job.platform] ?? job.platform}
                          title={PLATFORM_LABELS[job.platform] ?? job.platform}
                          width={22}
                          height={22}
                          style={{ borderRadius: 5, flexShrink: 0 }}
                        />
                      )}
                      <div style={{ minWidth: 0 }}>
                        <div className="list-item__name">{job.title}</div>
                        <div className="list-item__meta">
                          {job.company} · {job.location ?? "Remote"}
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: "var(--sp-1)",
                        flexShrink: 0,
                      }}
                    >
                      <Badge variant={jobStatusVariant(job.status)}>
                        {humanizeStatus(job.status)}
                      </Badge>
                      {score !== null && <MatchScoreBadge score={score} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ── Job detail ─────────────────────────────────────────── */}
        <div className="three-pane__panel">
          <div className="panel-header">
            <h2 className="panel-header__title">Detail</h2>
          </div>

          {selected === null ? (
            <EmptyState
              label="Select"
              title="No job selected"
              body="Click a job from the list to see details and match explanation."
            />
          ) : (
            <div
              style={{
                padding: "var(--sp-4)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--sp-4)",
              }}
            >
              {/* Header */}
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

              {/* Metadata grid */}
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

              {/* Score breakdown (only when scored) */}
              {selectedMatch !== null && (
                <div>
                  <h4 className="section-title" style={{ marginBottom: "var(--sp-2)" }}>
                    Score Breakdown
                  </h4>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--sp-2)",
                    }}
                  >
                    <ScoreBar
                      label="Overall"
                      value={selectedMatch.score}
                      variant={matchScoreVariant(selectedMatch.score)}
                    />
                    <ScoreBar
                      label="Role"
                      value={selectedMatch.roleScore}
                      variant={matchScoreVariant(selectedMatch.roleScore)}
                    />
                    <ScoreBar
                      label="Skills"
                      value={selectedMatch.skillScore}
                      variant={matchScoreVariant(selectedMatch.skillScore)}
                    />
                    <ScoreBar
                      label="Seniority"
                      value={selectedMatch.seniorityScore}
                      variant={matchScoreVariant(selectedMatch.seniorityScore)}
                    />
                    <ScoreBar
                      label="Location"
                      value={selectedMatch.locationScore}
                      variant={matchScoreVariant(selectedMatch.locationScore)}
                    />
                    <ScoreBar
                      label="Salary"
                      value={selectedMatch.salaryScore}
                      variant={matchScoreVariant(selectedMatch.salaryScore)}
                    />
                  </div>
                </div>
              )}

              {/* Description */}
              {selected.description != null && selected.description !== "" && (
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
                    {selected.description}
                  </div>
                </div>
              )}

              {/* Contact email — pre-filled mailto so the user just attaches CV and sends */}
              {selected.contactEmail != null && (
                <DetailField label="Contact email">
                  {(() => {
                    const subject =
                      extractAssunto(selected.description) ??
                      (selected.title ? `Candidatura — ${selected.title}` : "Candidatura");
                    const body =
                      "Olá,\n\nTenho interesse na vaga. Segue meu currículo em anexo.\n\nAtenciosamente,";
                    const href = `mailto:${selected.contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                    return (
                      <>
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
                          {selected.contactEmail}
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
                          onClick={() => {
                            if (activeProfileId === null) return;
                            const email = selected.contactEmail as string;
                            if (!window.confirm(`Send your CV to ${email} via Gmail?`)) return;
                            void (async () => {
                              setIsApplying(true);
                              try {
                                const docs = await safeInvoke<{ id: string }[]>(
                                  "list_cv_documents",
                                  { profileId: activeProfileId },
                                );
                                // Prefer the CV chosen in the Command Center
                                // (localStorage "hiremeops-selected-cv"); fall back
                                // to the first CV when none is set or it's stale.
                                const picked = localStorage.getItem("hiremeops-selected-cv");
                                const cvId =
                                  picked && docs?.some((d) => d.id === picked)
                                    ? picked
                                    : (docs?.[0]?.id ?? null);
                                await runGmailApply(activeProfileId, email, subject, body, cvId);
                                setSearchMsg(
                                  cvId === null
                                    ? `Application sent to ${email} (no CV attached — upload one in CV Library).`
                                    : `Application sent to ${email}`,
                                );
                              } catch (e) {
                                setSearchMsg(errMessage(e));
                              } finally {
                                setIsApplying(false);
                              }
                            })();
                          }}
                        >
                          {isApplying ? "Sending..." : "Auto-apply via Gmail"}
                        </Button>
                      </>
                    );
                  })()}
                </DetailField>
              )}

              {/* Contact phone — sniffed from the post text (not stored) */}
              {(() => {
                const phone = extractPhone(selected.description);
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
                      style={{
                        fontSize: "var(--text-2xs)",
                        color: "var(--color-text-muted)",
                        display: "block",
                      }}
                    >
                      Opens WhatsApp (assumes BR +55).
                    </span>
                  </DetailField>
                );
              })()}

              {/* Actions */}
              <Toolbar>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={isLoading}
                  onClick={handleQueueDetail}
                >
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
                {selected.platform === "catho" && (
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={isApplying || activeProfileId === null}
                    title="Submits your CV to this Catho offer in a visible window"
                    onClick={() => {
                      if (activeProfileId === null) return;
                      if (!window.confirm(`Apply to "${selected.title}" on Catho? This sends your CV.`))
                        return;
                      void (async () => {
                        setIsApplying(true);
                        try {
                          const res = await cathoApply(activeProfileId, selected.id, selected.url);
                          setSearchMsg(
                            res.status === "applied"
                              ? `Applied to "${selected.title}" on Catho.`
                              : res.status === "submitted"
                                ? `Submitted to "${selected.title}" (confirm in the window).`
                                : `Catho apply: ${res.status}${res.reason ? ` — ${res.reason}` : ""}`,
                          );
                        } catch (e) {
                          setSearchMsg(errMessage(e));
                        } finally {
                          setIsApplying(false);
                        }
                      })();
                    }}
                  >
                    {isApplying ? "Applying..." : "Apply on Catho"}
                  </Button>
                )}
                {selected.platform === "infojobs" && (
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={isApplying || activeProfileId === null}
                    title="Clicks CANDIDATAR-ME on this InfoJobs offer in a visible window"
                    onClick={() => {
                      if (activeProfileId === null) return;
                      if (
                        !window.confirm(
                          `Apply to "${selected.title}" on InfoJobs? This submits your candidacy.`,
                        )
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
                                  : `InfoJobs apply: ${res.status}${res.reason ? ` — ${res.reason}` : ""}`,
                          );
                        } catch (e) {
                          setSearchMsg(errMessage(e));
                        } finally {
                          setIsApplying(false);
                        }
                      })();
                    }}
                  >
                    {isApplying ? "Applying..." : "Apply on InfoJobs"}
                  </Button>
                )}
                {selected.platform === "indeed" &&
                  (indeedParked ? (
                    <>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={isApplying}
                        title="Submits the reviewed SmartApply form to Indeed"
                        onClick={() => {
                          if (!window.confirm(`Submit your application to "${selected.title}" on Indeed?`))
                            return;
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
                        {isApplying ? "Submitting..." : "Submit Indeed application"}
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
                  ) : (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={isApplying || activeProfileId === null}
                      title="Fills the Indeed SmartApply form and parks it for your review — does not submit"
                      onClick={() => {
                        if (activeProfileId === null) return;
                        void (async () => {
                          setIsApplying(true);
                          try {
                            await startIndeedApply(selected.url, activeProfileId);
                            setIndeedParked(true);
                            setSearchMsg(
                              `SmartApply form ready for "${selected.title}" — review it in the window, then submit or discard.`,
                            );
                          } catch (e) {
                            setSearchMsg(errMessage(e));
                          } finally {
                            setIsApplying(false);
                          }
                        })();
                      }}
                    >
                      {isApplying ? "Preparing..." : "Apply on Indeed"}
                    </Button>
                  ))}
                {selected.platform === "linkedin" &&
                  (linkedinParked ? (
                    <>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={isApplying}
                        title="Submits the reviewed Easy Apply form to LinkedIn"
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Submit your application to "${selected.title}" on LinkedIn?`,
                            )
                          )
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
                        {isApplying ? "Submitting..." : "Submit LinkedIn application"}
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
                      title="Fills + AI-answers the Easy Apply form and parks it for your review — does not submit"
                      onClick={() => void handleApplyLinkedIn()}
                    >
                      {isApplying ? "Preparing..." : "Apply on LinkedIn"}
                    </Button>
                  ))}
                <Button size="sm" onClick={() => void handleSkipSelected()}>
                  Skip
                </Button>
              </Toolbar>
            </div>
          )}
        </div>
      </div>

      <ApplicationDraftModal
        jobMatchId={selectedMatchId}
        open={draftModalOpen}
        onClose={() => setDraftModalOpen(false)}
      />
    </div>
  );
}

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
