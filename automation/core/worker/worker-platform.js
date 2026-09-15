import { cathoPushProfile } from "./catho.js";
import { gupyPushProfile, gupySearchJobs, gupyStartLogin } from "./gupy.js";
import { infojobsPushProfile } from "./infojobs.js";
import { infojobsSearchJobs, infojobsApply } from "./infojobs-jobs.js";
import { cathoSearchJobs, cathoApply } from "./catho-jobs.js";
import { upworkSearchJobs } from "./upwork-jobs.js";
import { freelas99SearchJobs } from "./freelas99-jobs.js";
import { programathorSearchJobs } from "./programathor-jobs.js";
import { geekhunterSearchJobs } from "./geekhunter-jobs.js";
import { activePage } from "./worker-context.js";
import { attachDiagnostics, captureDom } from "./capture.js";

export async function cmdCathoPushProfile({ handle, sections = [] }) {
  const page = await activePage(handle);
  return cathoPushProfile(page, sections);
}

export async function cmdGupyPushProfile({ handle, profile = {} }) {
  const page = await activePage(handle);
  return gupyPushProfile(page, profile);
}

export async function cmdSearchGupyJobs({ handle, query = "", remote_only = false, max_pages }) {
  const page = await activePage(handle);
  return gupySearchJobs(page, { query, remoteOnly: remote_only, maxPages: max_pages });
}

export async function cmdGupyStartLogin({ handle }) {
  const page = await activePage(handle);
  return gupyStartLogin(page);
}

export async function cmdInfojobsPushProfile({ handle, profile = {} }) {
  const page = await activePage(handle);
  return infojobsPushProfile(page, profile);
}

export async function cmdCapture({ handle, label = "manual" }) {
  const page = await activePage(handle);
  attachDiagnostics(page);
  return captureDom(page, label);
}

export async function cmdCathoSearchJobs({
  handle,
  query = "",
  area_ids = [],
  work_models = [],
  last_days,
  max_pages,
}) {
  const page = await activePage(handle);
  return cathoSearchJobs(page, {
    query,
    areaIds: area_ids,
    workModels: work_models,
    lastDays: last_days,
    maxPages: max_pages,
  });
}

export async function cmdCathoApply({ handle, offer_id, apply_url }) {
  const page = await activePage(handle);
  return cathoApply(page, { offerId: offer_id, applyUrl: apply_url });
}

export async function cmdUpworkSearchJobs({
  handle,
  query = "",
  sort = "recency",
  contractor_tier = [],
  job_type = [],
  max_pages,
}) {
  const page = await activePage(handle);
  return upworkSearchJobs(page, {
    query,
    sort,
    contractorTier: contractor_tier,
    jobType: job_type,
    maxPages: max_pages,
  });
}

export async function cmdFreelas99SearchJobs({ handle, query = "", max_pages }) {
  const page = await activePage(handle);
  return freelas99SearchJobs(page, { query, maxPages: max_pages });
}

export async function cmdProgramathorSearchJobs({ handle, query = "", max_pages }) {
  const page = await activePage(handle);
  return programathorSearchJobs(page, { query, maxPages: max_pages });
}

export async function cmdGeekhunterSearchJobs({ handle, query = "", remote_only, max_pages }) {
  const page = await activePage(handle);
  return geekhunterSearchJobs(page, { query, remoteOnly: !!remote_only, maxPages: max_pages });
}

export async function cmdInfojobsSearchJobs({
  handle,
  query = "",
  location = "",
  work_models = [],
  last_days,
  max_pages,
}) {
  const page = await activePage(handle);
  return infojobsSearchJobs(page, {
    query,
    location,
    workModels: work_models,
    lastDays: last_days,
    maxPages: max_pages,
  });
}

export async function cmdInfojobsApply({ handle, offer_id, apply_url, answers }) {
  const page = await activePage(handle);
  return infojobsApply(page, { offerId: offer_id, applyUrl: apply_url, answers });
}

