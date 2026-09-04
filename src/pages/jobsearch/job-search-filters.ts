import type { JobPostDto } from "../../types/domain";
import { extractPhone } from "../JobSearch.helpers";
import type { ContactFilter, FilterStatus, WorkModeFilter } from "./job-search-types";

const WORK_MODE_SYNONYMS: Record<string, string[]> = {
  remote: ["remote", "remoto", "home office", "home-office", "teletrabalho", "a distancia"],
  remoto: ["remote", "remoto", "home office", "home-office", "teletrabalho", "a distancia"],
  hybrid: ["hybrid", "hibrido"],
  hibrido: ["hybrid", "hibrido"],
  onsite: ["onsite", "on-site", "presencial", "presential", "no local"],
  presencial: ["onsite", "on-site", "presencial", "presential", "no local"],
};

const WORD_SPLIT = new RegExp("\\s+");

export interface JobFilterOptions {
  hideDuplicates: boolean;
  statusFilter: FilterStatus;
  platformFilter: string;
  workModeFilter: WorkModeFilter;
  wordsFilter: string;
  locationFilter: string;
  contactFilter: ContactFilter;
  minScore: number | "";
  scoreByJobId: Map<string, number>;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function matchesWorkMode(job: JobPostDto, mode: WorkModeFilter): boolean {
  if (mode === "all") return true;
  const haystack = normalizeText(
    `${job.remoteMode ?? ""} ${job.location ?? ""} ${job.title} ${job.description ?? ""}`,
  );
  const terms = WORK_MODE_SYNONYMS[mode] ?? [mode];
  return terms.some((term) => haystack.includes(term));
}

function matchesWords(job: JobPostDto, wordsFilter: string): boolean {
  const words = normalizeText(wordsFilter.trim());
  if (words === "") return true;
  const haystack = normalizeText(
    `${job.title} ${job.company} ${job.location ?? ""} ${job.description ?? ""} ${job.platform}`,
  );
  return words.split(WORD_SPLIT).every((term) => term === "" || haystack.includes(term));
}

function matchesLocation(job: JobPostDto, locationFilter: string): boolean {
  const location = normalizeText(locationFilter.trim());
  if (location === "") return true;
  const haystack = normalizeText(
    `${job.location ?? ""} ${job.remoteMode ?? ""} ${job.title} ${job.description ?? ""}`,
  );
  const terms = WORK_MODE_SYNONYMS[location] ?? [location];
  return terms.some((term) => haystack.includes(term));
}

function matchesSearchText(job: JobPostDto, options: JobFilterOptions): boolean {
  return (
    matchesWorkMode(job, options.workModeFilter) &&
    matchesWords(job, options.wordsFilter) &&
    matchesLocation(job, options.locationFilter)
  );
}

function matchesContact(job: JobPostDto, filter: ContactFilter): boolean {
  if (filter === "all") return true;
  const hasEmail = job.contactEmail != null && job.contactEmail !== "";
  const hasPhone = extractPhone(job.description) !== null;
  if (filter === "email") return hasEmail;
  if (filter === "phone") return hasPhone;
  return hasEmail || hasPhone;
}

function matchesJobBasics(job: JobPostDto, options: JobFilterOptions): boolean {
  if (options.hideDuplicates && job.status === "skipped_duplicate_url") return false;
  if (options.statusFilter !== "all" && job.status !== options.statusFilter) return false;
  return !(options.platformFilter !== "All" && job.platform !== options.platformFilter);
}

function matchesJobScore(job: JobPostDto, options: JobFilterOptions): boolean {
  if (typeof options.minScore !== "number" || options.minScore <= 0) return true;
  const score = options.scoreByJobId.get(job.id);
  return score === undefined || score >= options.minScore;
}

export function matchesJobFilter(job: JobPostDto, options: JobFilterOptions): boolean {
  return (
    matchesJobBasics(job, options) &&
    matchesSearchText(job, options) &&
    matchesContact(job, options.contactFilter) &&
    matchesJobScore(job, options)
  );
}
