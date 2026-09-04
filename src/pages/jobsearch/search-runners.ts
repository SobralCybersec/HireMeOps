import type { JobFilters, SearchQueryDto } from "../../types/domain";
import { errMessage } from "../../lib/tauriInvoke";
import { workModelsFrom } from "../JobSearch.helpers";
import {
  runCathoSearch,
  runFreelas99Search,
  runGeekhunterSearch,
  runGupySearch,
  runIndeedSearch,
  runInfojobsSearch,
  runProgramathorSearch,
  runUpworkSearch,
  runGoogleSearch,
  runLinkedInPostsSearch,
} from "../../stores/useJobStore";

export type SearchPlatform =
  | "linkedin"
  | "google"
  | "posts"
  | "catho"
  | "infojobs"
  | "gupy"
  | "indeed"
  | "upwork"
  | "99freelas"
  | "programathor"
  | "geekhunter";

export interface SearchRunnerContext {
  profileId: string;
  filters: JobFilters;
  selectedSkills: string[];
  available: SearchQueryDto[];
  setMessage: (message: string | null) => void;
  runSearch: (queryId: string) => Promise<number | null>;
  loadJobs: (profileId: string) => Promise<void>;
  loadMatches: (profileId: string) => Promise<void>;
  runLinkedIn: (
    profileId: string,
    queryId: string,
    keywords: string,
    location?: string,
    remoteOnly?: boolean,
  ) => Promise<{ ingested: number } | null>;
}

const rolesFrom = (filters: JobFilters) =>
  filters.targetRoles
    .map((role) => role.trim())
    .filter(Boolean)
    .slice(0, 3);
const targetFor = (available: SearchQueryDto[], platform: string) =>
  available.find((query) => query.platform === platform && query.enabled);

async function finishRoleBatch(
  ctx: SearchRunnerContext,
  label: string,
  roles: string[],
  total: number,
  target: SearchQueryDto | undefined,
) {
  const count = target ? await ctx.runSearch(target.id) : 0;
  const noun = label === "99freelas" ? "project" : "job";
  ctx.setMessage(
    `Scraped ${total} ${label} ${noun}${total === 1 ? "" : "s"} across ${roles.length} keyword${roles.length === 1 ? "" : "s"} · ${count ?? 0} scored`,
  );
  await ctx.loadJobs(ctx.profileId);
  await ctx.loadMatches(ctx.profileId);
}

async function runRoleBatch(
  ctx: SearchRunnerContext,
  label: string,
  roles: string[],
  scrape: (role: string) => Promise<{ ingested: number }>,
  target: SearchQueryDto | undefined,
) {
  if (roles.length === 0) {
    ctx.setMessage("Set a target role in Job Preferences first.");
    return false;
  }
  let total = 0;
  for (const role of roles) {
    ctx.setMessage(`Searching ${label} for "${role}"…`);
    try {
      total += (await scrape(role)).ingested;
    } catch (error) {
      ctx.setMessage(errMessage(error));
      return false;
    }
  }
  await finishRoleBatch(ctx, label, roles, total, target);
  return true;
}

async function runCatho(ctx: SearchRunnerContext) {
  const target = targetFor(ctx.available, "linkedin");
  const workModels = workModelsFrom(ctx.filters.remoteModes);
  return runRoleBatch(
    ctx,
    "Catho",
    rolesFrom(ctx.filters),
    (role) =>
      runCathoSearch({
        profileId: ctx.profileId,
        searchQueryId: target?.id ?? null,
        query: role,
        workModels: workModels.length ? workModels : undefined,
        maxPages: 5,
      }),
    target,
  );
}

async function runInfojobs(ctx: SearchRunnerContext) {
  const target = targetFor(ctx.available, "linkedin");
  const roles = rolesFrom(ctx.filters);
  const workModels = workModelsFrom(ctx.filters.remoteModes);
  const passes: (string[] | undefined)[] = workModels.length
    ? workModels.map((model) => [model])
    : [undefined];
  if (roles.length === 0) {
    ctx.setMessage("Set a target role in Job Preferences first.");
    return false;
  }
  let total = 0;
  for (const models of passes) {
    const passTotal = await scrapeInfojobsPass(ctx, target, roles, models);
    if (passTotal === null) return false;
    total += passTotal;
  }
  await finishRoleBatch(ctx, "InfoJobs", roles, total, target);
  return true;
}

async function runGupy(ctx: SearchRunnerContext) {
  const target = targetFor(ctx.available, "linkedin");
  const remoteOnly = ctx.filters.remoteModes.some((mode) => mode.toLowerCase().includes("remote"));
  return runRoleBatch(
    ctx,
    "Gupy",
    rolesFrom(ctx.filters),
    (role) => runGupySearch(ctx.profileId, target?.id ?? null, role, remoteOnly, 8),
    target,
  );
}

async function scrapeInfojobsRole(
  ctx: SearchRunnerContext,
  target: SearchQueryDto | undefined,
  role: string,
  models: string[] | undefined,
) {
  const suffix = models ? ` (${models[0]})` : "";
  ctx.setMessage(`Searching InfoJobs for "${role}"${suffix}…`);
  try {
    const options = {
      profileId: ctx.profileId,
      searchQueryId: target?.id ?? null,
      query: role,
      workModels: models,
      maxPages: 10,
    };
    const result = await runInfojobsSearch(options);
    return result.ingested;
  } catch (error) {
    ctx.setMessage(errMessage(error));
    return null;
  }
}

async function scrapeInfojobsPass(
  ctx: SearchRunnerContext,
  target: SearchQueryDto | undefined,
  roles: string[],
  models: string[] | undefined,
) {
  let total = 0;
  for (const role of roles) {
    const ingested = await scrapeInfojobsRole(ctx, target, role, models);
    if (ingested === null) return null;
    total += ingested;
  }
  return total;
}

async function runUpwork(ctx: SearchRunnerContext) {
  const target = targetFor(ctx.available, "linkedin");
  return runRoleBatch(
    ctx,
    "Upwork",
    rolesFrom(ctx.filters),
    (role) => runUpworkSearch(ctx.profileId, target?.id ?? null, role, "recency", 3),
    target,
  );
}

async function runFreelas(ctx: SearchRunnerContext) {
  const target = targetFor(ctx.available, "linkedin");
  return runRoleBatch(
    ctx,
    "99freelas",
    rolesFrom(ctx.filters),
    (role) => runFreelas99Search(ctx.profileId, target?.id ?? null, role, 3),
    target,
  );
}

async function runProgramathor(ctx: SearchRunnerContext) {
  const target = targetFor(ctx.available, "linkedin");
  return runRoleBatch(
    ctx,
    "ProgramaThor",
    rolesFrom(ctx.filters),
    (role) => runProgramathorSearch(ctx.profileId, target?.id ?? null, role, 5),
    target,
  );
}

async function runGeekhunter(ctx: SearchRunnerContext) {
  const target = targetFor(ctx.available, "linkedin");
  const remoteOnly = workModelsFrom(ctx.filters.remoteModes).includes("remote");
  return runRoleBatch(
    ctx,
    "GeekHunter",
    rolesFrom(ctx.filters),
    (role) => runGeekhunterSearch(ctx.profileId, target?.id ?? null, role, remoteOnly, 5),
    target,
  );
}

async function runIndeed(ctx: SearchRunnerContext) {
  const target = targetFor(ctx.available, "linkedin");
  const remote = ctx.filters.remoteModes.some((mode) => mode.toLowerCase().includes("remote"));
  const country = ctx.filters.locations[0];
  return runRoleBatch(
    ctx,
    "Indeed",
    rolesFrom(ctx.filters),
    (role) => runIndeedSearch(ctx.profileId, target?.id ?? null, role, country, remote, 3),
    target,
  );
}

async function runPosts(ctx: SearchRunnerContext) {
  const target = targetFor(ctx.available, "linkedin_post");
  if (!target) {
    ctx.setMessage("No hiring-posts query available.");
    return false;
  }
  try {
    const result = await runLinkedInPostsSearch(ctx.profileId, target.id, target.query);
    const count = await ctx.runSearch(target.id);
    ctx.setMessage(
      `Scraped ${result.ingested} hiring post${result.ingested === 1 ? "" : "s"} across ${result.pagesScraped} page${result.pagesScraped === 1 ? "" : "s"} · ${count ?? 0} scored`,
    );
    await ctx.loadJobs(ctx.profileId);
    await ctx.loadMatches(ctx.profileId);
    return true;
  } catch (error) {
    ctx.setMessage(errMessage(error));
    return false;
  }
}

function linkedInQueries(ctx: SearchRunnerContext, roles: string[]) {
  const skills = (ctx.selectedSkills.length ? ctx.selectedSkills : ctx.filters.requiredSkills)
    .map((skill) => skill.trim())
    .filter(Boolean)
    .slice(0, 4);
  return roles
    .flatMap((role) =>
      skills.length ? skills.map((skill) => `"${role}" AND "${skill}"`) : [`"${role}"`],
    )
    .slice(0, 8);
}

function linkedInStatus(query: string, country: string | null) {
  const countrySuffix = country ? ` · ${country}` : "";
  return `Searching LinkedIn: ${query}${countrySuffix}…`;
}

async function runLinkedInCountry(options: {
  ctx: SearchRunnerContext;
  target: SearchQueryDto;
  query: string;
  country: string | null;
  remote: boolean;
}) {
  const { ctx, target, query, country, remote } = options;
  ctx.setMessage(linkedInStatus(query, country));
  const result = await ctx.runLinkedIn(
    ctx.profileId,
    target.id,
    query,
    country ?? undefined,
    remote,
  );
  return result?.ingested ?? null;
}

async function runLinkedIn(ctx: SearchRunnerContext) {
  const target = targetFor(ctx.available, "linkedin");
  if (!target) {
    ctx.setMessage("No linkedin query available.");
    return false;
  }
  const roles = rolesFrom(ctx.filters);
  if (roles.length === 0) {
    ctx.setMessage("Set a target role in Job Preferences first.");
    return false;
  }
  const queries = linkedInQueries(ctx, roles);
  const countries = ctx.filters.locations.length ? ctx.filters.locations : [null];
  const remote = ctx.filters.remoteModes.some((mode) => mode.toLowerCase().includes("remote"));
  let total = 0;
  for (const country of countries)
    for (const query of queries) {
      const ingested = await runLinkedInCountry({ ctx, target, query, country, remote });
      if (ingested === null) return false;
      total += ingested;
    }
  const suffix = countries.length > 1 ? ` in ${countries.length} countries` : "";
  const count = await ctx.runSearch(target.id);
  ctx.setMessage(
    `Scraped ${total} new job${total === 1 ? "" : "s"} across ${queries.length} keyword combo${queries.length === 1 ? "" : "s"}${suffix} · ${count ?? 0} scored against your CV.`,
  );
  return true;
}

async function runGoogle(ctx: SearchRunnerContext) {
  const queries = ctx.available.filter((query) => query.platform === "google" && query.enabled);
  let ingested = 0;
  let scored = 0;
  for (let index = 0; index < queries.length; index += 1) {
    const query = queries[index];
    ctx.setMessage(`Searching Google dork (${index + 1}/${queries.length})…`);
    try {
      const result = await runGoogleSearch(ctx.profileId, query.id, query.query);
      if (result.blocked) {
        ctx.setMessage(
          `Google blocked the request after ${index} dork${index === 1 ? "" : "s"}. Try again later or solve the captcha.`,
        );
        break;
      }
      ingested += result.ingested;
      scored += (await ctx.runSearch(query.id)) ?? 0;
    } catch (error) {
      ctx.setMessage(errMessage(error));
      return false;
    }
  }
  ctx.setMessage(
    `Scraped ${ingested} Google result${ingested === 1 ? "" : "s"} across ${queries.length} dork quer${queries.length === 1 ? "y" : "ies"} · ${scored} scored`,
  );
  return true;
}

const RUNNERS: Record<SearchPlatform, (ctx: SearchRunnerContext) => Promise<boolean>> = {
  linkedin: runLinkedIn,
  google: runGoogle,
  posts: runPosts,
  catho: runCatho,
  infojobs: runInfojobs,
  gupy: runGupy,
  indeed: runIndeed,
  upwork: runUpwork,
  "99freelas": runFreelas,
  programathor: runProgramathor,
  geekhunter: runGeekhunter,
};

export function runPlatformSearch(platform: SearchPlatform, ctx: SearchRunnerContext) {
  return RUNNERS[platform](ctx);
}
