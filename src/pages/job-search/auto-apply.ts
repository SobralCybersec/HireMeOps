import type { JobMatchDto, JobPostDto, JobStatus } from "../../types/domain";
import {
  cathoApply,
  confirmIndeedSubmit,
  draftApplication,
  infojobsApply,
  startIndeedApply,
  submitApplication,
} from "../../stores/useJobStore";
import { useAutomationStore } from "../../stores/useAutomationStore";

interface AutoApplyContext {
  profileId: string;
  jobs: JobPostDto[];
  matches: JobMatchDto[];
  isApplying: boolean;
  setMessage: (message: string) => void;
  setApplying: (value: boolean) => void;
  setJobStatus: (jobId: string, status: JobStatus) => Promise<void>;
  loadJobs: (profileId: string) => Promise<void>;
  loadMatches: (profileId: string) => Promise<void>;
}

interface ApplyCounts {
  applied: number;
  attention: number;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function applyDirectJobs(ctx: AutoApplyContext, jobs: JobPostDto[]): Promise<ApplyCounts> {
  const counts = { applied: 0, attention: 0 };
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    ctx.setMessage(`Auto-applying (${job.platform}) ${index + 1}/${jobs.length}: "${job.title}"…`);
    try {
      const result =
        job.platform === "catho"
          ? await cathoApply(ctx.profileId, job.id, job.url)
          : await infojobsApply(ctx.profileId, job.id, job.url);
      const applied = ["applied", "submitted", "already_applied"].includes(result.status);
      await ctx.setJobStatus(job.id, applied ? "applied" : "needs_review");
      counts[applied ? "applied" : "attention"] += 1;
    } catch {
      await ctx.setJobStatus(job.id, "failed");
      counts.attention += 1;
    }
  }
  return counts;
}

async function applyIndeedJobs(ctx: AutoApplyContext, jobs: JobPostDto[]): Promise<ApplyCounts> {
  const counts = { applied: 0, attention: 0 };
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    ctx.setMessage(`Auto-applying (indeed) ${index + 1}/${jobs.length}: "${job.title}"…`);
    try {
      await startIndeedApply(job.url, ctx.profileId);
      await confirmIndeedSubmit();
      await ctx.setJobStatus(job.id, "applied");
      counts.applied += 1;
    } catch {
      await ctx.setJobStatus(job.id, "needs_review");
      counts.attention += 1;
    }
  }
  return counts;
}

async function waitForLinkedInQueue(ctx: AutoApplyContext, enqueued: number) {
  ctx.setMessage(`Running LinkedIn Easy Apply for ${enqueued} job${enqueued === 1 ? "" : "s"}…`);
  await useAutomationStore.getState().start();
  const deadline = Date.now() + 15 * 60 * 1000;
  let applied = 0;
  for (;;) {
    await sleep(2500);
    const state = useAutomationStore.getState().state;
    if (state === "NeedsReview") {
      await useAutomationStore.getState().confirmSubmit();
      applied += 1;
      await sleep(1500);
    } else if (["Completed", "Failed", "Stopped"].includes(state) || Date.now() > deadline) {
      break;
    }
  }
  return applied;
}

async function applyLinkedInJobs(ctx: AutoApplyContext, jobs: JobPostDto[]): Promise<ApplyCounts> {
  const counts = { applied: 0, attention: 0 };
  let enqueued = 0;
  for (const job of jobs) {
    const matchId = ctx.matches.find((match) => match.jobId === job.id)?.id;
    if (!matchId) {
      await ctx.setJobStatus(job.id, "needs_review");
      counts.attention += 1;
      continue;
    }
    try {
      await submitApplication(await draftApplication(matchId));
      enqueued += 1;
    } catch {
      await ctx.setJobStatus(job.id, "failed");
      counts.attention += 1;
    }
  }
  if (enqueued > 0) counts.applied += await waitForLinkedInQueue(ctx, enqueued);
  return counts;
}

export async function runAutoApply(ctx: AutoApplyContext) {
  if (ctx.isApplying) return;
  const queued = ctx.jobs.filter((job) => job.status === "queued");
  const direct = queued.filter((job) => job.platform === "catho" || job.platform === "infojobs");
  const indeed = queued.filter((job) => job.platform === "indeed");
  const linkedin = queued.filter((job) => job.platform === "linkedin");
  const total = direct.length + indeed.length + linkedin.length;
  if (!total) {
    ctx.setMessage("No queued jobs to auto-apply.");
    return;
  }
  if (
    !window.confirm(
      `Auto-apply to ${total} queued job${total === 1 ? "" : "s"}? Each submits a REAL application in a visible window (Catho/InfoJobs/Indeed one-shot; LinkedIn Easy Apply is filled and auto-confirmed).`,
    )
  )
    return;
  ctx.setApplying(true);
  const counts = { applied: 0, attention: 0 };
  try {
    const directCounts = await applyDirectJobs(ctx, direct);
    counts.applied += directCounts.applied;
    counts.attention += directCounts.attention;
    const indeedCounts = await applyIndeedJobs(ctx, indeed);
    counts.applied += indeedCounts.applied;
    counts.attention += indeedCounts.attention;
    const linkedinCounts = await applyLinkedInJobs(ctx, linkedin);
    counts.applied += linkedinCounts.applied;
    counts.attention += linkedinCounts.attention;
  } finally {
    ctx.setApplying(false);
    await ctx.loadJobs(ctx.profileId);
    await ctx.loadMatches(ctx.profileId);
  }
  ctx.setMessage(
    `Auto-apply done · ${counts.applied} applied · ${counts.attention} need attention.`,
  );
}
