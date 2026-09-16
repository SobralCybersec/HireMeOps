import { performance } from "node:perf_hooks";
import { closeCloudBrowser, openCloudBrowser } from "./cloud/cloud-browser.mjs";
import { dispatchCloudOperation } from "./cloud/cloud-dispatch.mjs";
import { memorySnapshot } from "./cloud-memory.mjs";
import { randomUUID } from "node:crypto";
import { sessions } from "./core/worker/worker-context.js";

const VIEWPORTS = new Map([
  ["1024x768", { width: 1024, height: 768 }],
  ["900x675", { width: 900, height: 675 }],
  ["800x600", { width: 800, height: 600 }],
]);

const OPERATIONS = {
  linkedin: {
    cmd: "search_jobs",
    args: {
      keywords: "synthetic",
      location: "São Paulo",
      page_index: 0,
      filters: { easy_apply_only: false },
    },
  },
  linkedin_posts: { cmd: "search_linkedin_posts", args: { keywords: "synthetic", page_index: 0 } },
  google: { cmd: "search_google", args: { query: "synthetic", page_index: 0 } },
  indeed: {
    cmd: "search_indeed_jobs",
    args: { keywords: "synthetic", location: "Brasil", page_index: 0 },
  },
  gupy: { cmd: "search_gupy_jobs", args: { query: "synthetic", max_pages: 1 } },
  catho: { cmd: "catho_search_jobs", args: { query: "synthetic", max_pages: 1 } },
  infojobs: { cmd: "infojobs_search_jobs", args: { query: "synthetic", max_pages: 1 } },
  upwork: { cmd: "upwork_search_jobs", args: { query: "synthetic", max_pages: 1 } },
  freelas99: { cmd: "freelas99_search_jobs", args: { query: "synthetic", max_pages: 1 } },
  programathor: { cmd: "programathor_search_jobs", args: { query: "synthetic", max_pages: 1 } },
  geekhunter: { cmd: "geekhunter_search_jobs", args: { query: "synthetic", max_pages: 1 } },
};

const FIXTURE_HTML = `<!doctype html>
<html><head><title>synthetic browser benchmark</title></head><body>
  <main>
    <div id="mosaic-provider-jobcards">
      <div data-testid="slider_item" class="resultContent">
        <h3 class="jobTitle"><a data-jk="indeed-1" href="https://example.test/indeed-1"><span>Synthetic Indeed role</span></a></h3>
        <div data-testid="company-name">Synthetic Client</div><div data-testid="text-location">São Paulo</div>
      </div>
    </div>
    <ul id="job-listing-results"><li>
      <a href="https://portal.gupy.io/job/gupy-1"><h3>Synthetic Gupy role</h3><p>Synthetic company</p></a>
      <span data-testid="job-location">São Paulo</span><div data-testid="listing-details"><span>Remote</span></div>
    </li></ul>
    <article class="offer" data-offer-item="catho-1"><h2 class="title_offer"><a href="/vagas/synthetic/123" title="Synthetic Catho role">Synthetic Catho role</a></h2>
      <p class="mb-2"><span class="text-12">Synthetic company</span></p><p><i class="i_job_location"></i> - São Paulo</p>
      <p><i class="i_salary"></i><strong>R$ 10.000</strong></p></article>
    <div id="vacancy-1" data-id="infojobs-1" data-href="/vaga-synthetic-1">
      <div class="js_vacancyTitle">Synthetic InfoJobs role</div><div class="d-flex align-items-baseline"><span class="text-body">Synthetic company</span></div>
      <div class="mb-8">São Paulo</div><div class="text-medium">Synthetic description</div>
    </div><div id="resumeVacancies"><span>1</span></div>
    <article class="job-tile" data-test="JobTile" data-ev-job-uid="upwork-1"><a data-test="job-tile-title-link" href="https://www.upwork.com/jobs/~02upwork-1">Synthetic Upwork role</a>
      <ul data-test="JobInfo"><li>Fixed price</li></ul><div data-test="JobDescription"><p>Synthetic description</p></div></article>
    <li class="result-item" data-id="freelas-1"><hgroup><h1 class="title"><a href="/project/synthetic-1">Synthetic 99freelas role</a></h1></hgroup>
      <div class="item-text information">São Paulo</div><div class="item-text client"><a>Synthetic client</a></div><div class="item-text description">Synthetic description</div></li>
    <div class="cell-list"><a href="/jobs/123-synthetic"><h3>Synthetic Programathor role</h3><span class="cell-list-content-icon"><i class="fa-briefcase"></i><span>Synthetic company</span></span><span class="cell-list-content-icon"><i class="fa-map-marker-alt"></i><span>São Paulo</span></span><span class="tag-list background-gray">JavaScript</span></a></div>
    <a aria-label="Visualizar vaga" href="/pt/synthetic-company/jobs/synthetic-role"><p class="chakra-text">Synthetic GeekHunter role</p><p class="chakra-text">São Paulo, SP</p><p class="chakra-text">Remoto</p><span class="css-dqhvn">JavaScript</span></a>
    <li data-occludable-job-id=""><a class="job-card-list__title--link" href="https://www.linkedin.com/jobs/view/synthetic-1"><span aria-hidden="true">Synthetic LinkedIn role</span></a><div class="artdeco-entity-lockup__subtitle">Synthetic company · São Paulo</div></li>
    <div componentkey="post-1" data-urn="urn:li:activity:1234567890"><span data-testid="expandable-text-box">Synthetic LinkedIn post</span><a href="/in/synthetic-author">Synthetic author</a></div>
    <div class="g"><a href="https://example.test/result"><h3>Synthetic Google result</h3><div class="VwiC3b">Synthetic description</div></a></div><a id="pnnext" href="/next">next</a>
  </main>
</body></html>`;

function argsFor(platform) {
  const operation = OPERATIONS[platform];
  return operation ? { ...operation.args, cmd: operation.cmd } : null;
}

function parseArgs() {
  const values = {};
  for (let index = 2; index < process.argv.length; index += 1) {
    const value = process.argv[index];
    if (value.startsWith("--")) values[value.slice(2)] = process.argv[index + 1];
  }
  const viewport = VIEWPORTS.get(values.viewport);
  if (!viewport || !OPERATIONS[values.platform]) throw new Error("invalid benchmark arguments");
  return { platform: values.platform, viewportName: values.viewport, viewport };
}

async function installFixtureRoutes(context) {
  await context.route("**/*", async (route) => {
    if (route.request().resourceType() === "document") {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: FIXTURE_HTML,
      });
      return;
    }
    await route.fulfill({ status: 204, body: "" });
  });
}

function resultJobs(result) {
  if (Array.isArray(result?.jobs)) return result.jobs;
  if (Array.isArray(result?.results)) return result.results;
  if (Array.isArray(result?.posts)) return result.posts;
  return [];
}

const REQUIRED_FIELDS = {
  linkedin: ["title", "company", "location", "url"],
  linkedin_posts: ["title", "company", "description", "url"],
  google: ["title", "description", "url"],
  indeed: ["title", "company", "location", "url"],
  gupy: ["title", "company", "location", "description", "url"],
  catho: ["title", "company", "location", "description", "url"],
  infojobs: ["title", "company", "location", "description", "url"],
  upwork: ["title", "description", "url"],
  freelas99: ["title", "company", "description", "url"],
  programathor: ["title", "company", "location", "description", "url"],
  geekhunter: ["title", "company", "location", "description", "url"],
};

function validateResults(platform, result) {
  const jobs = resultJobs(result);
  const fields = jobs.map((job) => ({
    title: Boolean(job.title || job.text),
    company: Boolean(job.company || job.author || job.client),
    location: Boolean(job.location),
    description: Boolean(job.description || job.snippet || job.text),
    url: Boolean(job.apply_url || job.url),
  }));
  const requiredFields = REQUIRED_FIELDS[platform];
  const fieldsValid = fields.every((field) => requiredFields.every((key) => field[key]));
  return {
    count: jobs.length,
    fields,
    requiredFields,
    selectorsWorked: jobs.length > 0 && fieldsValid,
    fieldsValid,
    pagination: typeof result?.has_next_page === "boolean",
    noResultsDetection: jobs.length === 0 ? "not-observed" : "fixture-results-present",
  };
}

function metrics(stages) {
  const max = (key) => Math.max(...stages.map((stage) => stage[key] ?? 0));
  return {
    cgroupPeakMb: Math.max(...stages.map((stage) => stage.cgroupPeakMb ?? 0)),
    cgroupCurrentMaxMb: max("cgroupCurrentMb"),
    chromiumPssMaxMb: max("chromiumPssMb"),
    nodePssMaxMb: max("nodePssMb"),
    chromiumProcessesMax: max("chromiumProcesses"),
  };
}

async function runBenchmark({ platform, viewportName, viewport }) {
  const started = performance.now();
  const stages = [];
  const record = (stage) => stages.push(memorySnapshot(stage));
  const handle = randomUUID();
  let runtime;
  let result;
  let error = null;
  let row;
  try {
    record("startup");
    runtime = await openCloudBrowser({ cookies: [], origins: [] }, { viewport });
    await installFixtureRoutes(runtime.context);
    sessions.set(handle, { browser: runtime.context, page: runtime.page, user_data_dir: null });
    record("browser-open");
    record("operation-start");
    result = await dispatchCloudOperation({ ...argsFor(platform), handle });
    record("post-navigation");
    const validation = validateResults(platform, result);
    record("scraping-peak");
    await runtime.context.storageState({ indexedDB: true });
    record("state-exported");
    row = {
      platform,
      viewport: viewportName,
      durationMs: +(performance.now() - started).toFixed(1),
      exitCode: 0,
      timeout: false,
      oom: false,
      responsiveLayout: "synthetic desktop fixture stable",
      ...validation,
    };
  } catch (caught) {
    error = caught;
    const validation = validateResults(platform, result);
    row = {
      platform,
      viewport: viewportName,
      durationMs: +(performance.now() - started).toFixed(1),
      exitCode: 1,
      timeout: /timeout/i.test(String(caught?.message ?? caught)),
      oom: false,
      responsiveLayout: "not-validated",
      ...validation,
      error: String(caught?.message ?? caught)
        .replace(/\s+/g, " ")
        .slice(0, 240),
    };
  } finally {
    sessions.delete(handle);
    record("pre-close");
    await closeCloudBrowser(runtime);
    await new Promise((resolve) => setTimeout(resolve, 150));
    record("shutdown");
    Object.assign(row, metrics(stages), { stages });
    if (error) process.exitCode = 1;
  }
  return row;
}

try {
  const row = await runBenchmark(parseArgs());
  process.stdout.write(`${JSON.stringify(row)}\n`);
} catch (error) {
  process.stderr.write(`[viewport-benchmark] ${String(error?.message ?? error).slice(0, 200)}\n`);
  process.exitCode = 2;
}
