import { activePage } from "../core/worker/worker-context.js";
import { CloudRunnerError } from "../cloud-runner-contract.mjs";

const DISPATCHERS = {
  search_jobs: async (request) => {
    const { cmdSearchJobs } = await import("../platforms/linkedin/worker-linkedin.js");
    return cmdSearchJobs(request);
  },
  search_linkedin_posts: async (request) => {
    const { cmdSearchLinkedInPosts } = await import("../platforms/linkedin/worker-linkedin.js");
    return cmdSearchLinkedInPosts(request);
  },
  search_google: async (request) => {
    const { cmdSearchGoogle } = await import("../platforms/linkedin/worker-linkedin.js");
    return cmdSearchGoogle(request);
  },
  search_indeed_jobs: async (request, hooks) => {
    const { cmdSearchIndeedJobs } = await import("../platforms/indeed/worker-indeed.js");
    return cmdSearchIndeedJobs(request, hooks);
  },
  catho_search_jobs: async (request, hooks) => {
    const { cathoSearchJobs } = await import("../platforms/catho/catho-jobs.js");
    return cathoSearchJobs(await activePage(request.handle), {
      query: request.query ?? "",
      areaIds: request.area_ids ?? [],
      workModels: request.work_models ?? [],
      lastDays: request.last_days,
      maxPages: request.max_pages,
      onJobsDiscovered: hooks?.onJobsDiscovered,
    });
  },
  search_gupy_jobs: async (request, hooks) => {
    const { gupySearchJobs } = await import("../platforms/gupy/gupy.js");
    return gupySearchJobs(await activePage(request.handle), {
      query: request.query ?? "",
      remoteOnly: request.remote_only ?? false,
      maxPages: request.max_pages,
      onJobsDiscovered: hooks?.onJobsDiscovered,
    });
  },
  infojobs_search_jobs: async (request, hooks) => {
    const { infojobsSearchJobs } = await import("../platforms/infojobs/infojobs-jobs.js");
    return infojobsSearchJobs(await activePage(request.handle), {
      query: request.query ?? "",
      location: request.location ?? "",
      workModels: request.work_models ?? [],
      lastDays: request.last_days,
      maxPages: request.max_pages,
      onJobsDiscovered: hooks?.onJobsDiscovered,
    });
  },
  upwork_search_jobs: async (request, hooks) => {
    const { upworkSearchJobs } = await import("../platforms/upwork/upwork-jobs.js");
    return upworkSearchJobs(await activePage(request.handle), {
      query: request.query ?? "",
      sort: request.sort ?? "recency",
      contractorTier: request.contractor_tier ?? [],
      jobType: request.job_type ?? [],
      maxPages: request.max_pages,
      onJobsDiscovered: hooks?.onJobsDiscovered,
    });
  },
  freelas99_search_jobs: async (request, hooks) => {
    const { freelas99SearchJobs } = await import("../platforms/freelas99/freelas99-jobs.js");
    return freelas99SearchJobs(await activePage(request.handle), {
      query: request.query ?? "",
      maxPages: request.max_pages,
      onJobsDiscovered: hooks?.onJobsDiscovered,
    });
  },
  programathor_search_jobs: async (request, hooks) => {
    const { programathorSearchJobs } =
      await import("../platforms/programathor/programathor-jobs.js");
    return programathorSearchJobs(await activePage(request.handle), {
      query: request.query ?? "",
      maxPages: request.max_pages,
      onJobsDiscovered: hooks?.onJobsDiscovered,
    });
  },
  geekhunter_search_jobs: async (request, hooks) => {
    const { geekhunterSearchJobs } = await import("../platforms/geekhunter/geekhunter-jobs.js");
    return geekhunterSearchJobs(await activePage(request.handle), {
      query: request.query ?? "",
      remoteOnly: !!request.remote_only,
      maxPages: request.max_pages,
      onJobsDiscovered: hooks?.onJobsDiscovered,
    });
  },
  catho_apply: async (request) => {
    const { cathoApply } = await import("../platforms/catho/catho-jobs.js");
    return cathoApply(await activePage(request.handle), {
      offerId: request.offer_id,
      applyUrl: request.apply_url,
    });
  },
  infojobs_apply: async (request) => {
    const { infojobsApply } = await import("../platforms/infojobs/infojobs-jobs.js");
    return infojobsApply(await activePage(request.handle), {
      offerId: request.offer_id,
      applyUrl: request.apply_url,
      answers: request.answers,
    });
  },
};

export async function dispatchCloudOperation(request) {
  const dispatch = DISPATCHERS[request?.cmd];
  if (!dispatch) throw new CloudRunnerError("unsupported_operation");
  return dispatch(request);
}

export function isCloudOperationSupported(command) {
  return typeof command === "string" && command in DISPATCHERS;
}
