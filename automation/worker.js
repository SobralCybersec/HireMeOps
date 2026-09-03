import readline from "readline";
import { initPerf, perfEnabled, nowMs, logSpan } from "./perf.js";
import { sessions, activePage, closeAll, writeLine } from "./worker-context.js";
import { attachDiagnostics, captureResult, captureDom } from "./capture.js";
import {
  cmdOpen, cmdNavigate, cmdProbe, cmdSolveCaptcha, cmdFillEasyApply, cmdAnswerEasyApply,
  cmdConfirmSubmit, cmdRejectSubmit, cmdScreenshot, cmdDomSnapshot, cmdExtractHr,
} from "./worker-lifecycle.js";
import { cmdSearchJobs, cmdSearchLinkedInPosts, cmdSearchGoogle } from "./worker-linkedin.js";
import { cmdCheckLogin, cmdOpenLoginTabs, cmdCheckLogins, cmdClose } from "./worker-auth.js";
import {
  cmdSearchIndeedJobs, cmdFillIndeedApply, cmdAnswerIndeedFreeText, cmdConfirmIndeedSubmit,
  cmdRejectIndeedSubmit, cmdShutdown,
} from "./worker-indeed.js";
import { cmdPushProfile } from "./worker-profile.js";
import {
  cmdCathoPushProfile, cmdGupyPushProfile, cmdSearchGupyJobs, cmdGupyStartLogin,
  cmdInfojobsPushProfile, cmdCapture, cmdCathoSearchJobs, cmdCathoApply, cmdUpworkSearchJobs,
  cmdFreelas99SearchJobs, cmdProgramathorSearchJobs, cmdGeekhunterSearchJobs,
  cmdInfojobsSearchJobs, cmdInfojobsApply,
} from "./worker-platform.js";
import { cmdAutoConnect, cmdGmailSend } from "./worker-network.js";

initPerf();

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", async (raw) => {
  const line = raw.trim();
  if (!line) return;

  let cmd;
  try {
    cmd = JSON.parse(line);
  } catch (e) {
    process.stderr.write(`[worker] parse error: ${e.message}\n`);
    return;
  }

  const { id } = cmd;
  const t0 = perfEnabled() ? nowMs() : 0;
  try {
    const data = await dispatch(cmd);
    if (perfEnabled()) {
      logSpan("cmd", { cmd: cmd.cmd, ms: +(nowMs() - t0).toFixed(1), rssMb: rssMb() });
    }
    writeLine({ id, ok: true, ...data });
  } catch (err) {
    if (perfEnabled()) {
      logSpan("cmd", { cmd: cmd.cmd, ms: +(nowMs() - t0).toFixed(1), error: true });
    }
    writeLine({ id, ok: false, error: err?.message ?? String(err) });
  }
});

function rssMb() {
  return +(process.memoryUsage.rss() / 1_048_576).toFixed(1);
}

rl.on("close", async () => {
  await closeAll();
  process.exit(0);
});

const CAPTURE_CMDS = new Set([
  "fill_easy_apply",
  "answer_easy_apply",
  "confirm_submit",
  "reject_submit",
  "extract_hr",
  "search_jobs",
  "search_linkedin_posts",
  "search_google",
  "push_profile",
  "catho_push_profile",
  "gupy_push_profile",
  "infojobs_push_profile",
  "search_gupy_jobs",
  "gupy_start_login",
  "catho_search_jobs",
  "catho_apply",
  "infojobs_search_jobs",
  "infojobs_apply",
  "upwork_search_jobs",
  "freelas99_search_jobs",
  "programathor_search_jobs",
  "geekhunter_search_jobs",
  "auto_connect",
  "search_indeed_jobs",
  "fill_indeed_apply",
  "answer_indeed_free_text",
  "confirm_indeed_submit",
  "reject_indeed_submit",
]);

async function dispatch(cmd) {
  if (!CAPTURE_CMDS.has(cmd.cmd) || cmd.handle == null) return route(cmd);
  let page = null;
  try {
    page = await activePage(cmd.handle);
    attachDiagnostics(page);
  } catch {}
  try {
    const result = await route(cmd);
    return page ? await captureResult(page, cmd.cmd, result) : result;
  } catch (e) {
    if (page)
      await captureDom(page, `${cmd.cmd}_throw`, { error: String(e?.message ?? e) }).catch(
        () => {},
      );
    throw e;
  }
}

const COMMAND_HANDLERS = {
  open: cmdOpen,
  navigate: cmdNavigate,
  probe: cmdProbe,
  fill_easy_apply: cmdFillEasyApply,
  answer_easy_apply: cmdAnswerEasyApply,
  confirm_submit: cmdConfirmSubmit,
  reject_submit: cmdRejectSubmit,
  screenshot: cmdScreenshot,
  dom_snapshot: cmdDomSnapshot,
  capture: cmdCapture,
  close: cmdClose,
  shutdown: cmdShutdown,
  extract_hr: cmdExtractHr,
  search_jobs: cmdSearchJobs,
  search_linkedin_posts: cmdSearchLinkedInPosts,
  search_google: cmdSearchGoogle,
  push_profile: cmdPushProfile,
  catho_push_profile: cmdCathoPushProfile,
  gupy_push_profile: cmdGupyPushProfile,
  search_gupy_jobs: cmdSearchGupyJobs,
  gupy_start_login: cmdGupyStartLogin,
  infojobs_push_profile: cmdInfojobsPushProfile,
  catho_search_jobs: cmdCathoSearchJobs,
  catho_apply: cmdCathoApply,
  infojobs_search_jobs: cmdInfojobsSearchJobs,
  infojobs_apply: cmdInfojobsApply,
  upwork_search_jobs: cmdUpworkSearchJobs,
  freelas99_search_jobs: cmdFreelas99SearchJobs,
  programathor_search_jobs: cmdProgramathorSearchJobs,
  geekhunter_search_jobs: cmdGeekhunterSearchJobs,
  auto_connect: cmdAutoConnect,
  search_indeed_jobs: cmdSearchIndeedJobs,
  fill_indeed_apply: cmdFillIndeedApply,
  answer_indeed_free_text: cmdAnswerIndeedFreeText,
  confirm_indeed_submit: cmdConfirmIndeedSubmit,
  reject_indeed_submit: cmdRejectIndeedSubmit,
  check_login: cmdCheckLogin,
  open_login_tabs: cmdOpenLoginTabs,
  check_logins: cmdCheckLogins,
  solve_captcha: cmdSolveCaptcha,
  start_screencast: cmdStartScreencast,
  stop_screencast: cmdStopScreencast,
  gmail_send: cmdGmailSend,
};

async function route(cmd) {
  const handler = COMMAND_HANDLERS[cmd.cmd];
  if (!handler) throw new Error(`Unknown command: ${cmd.cmd}`);
  return handler(cmd);
}

export async function cmdStartScreencast({ handle }) {
  const sess = sessions.get(handle);
  if (!sess || !sess.page) throw new Error(`start_screencast: unknown handle ${handle}`);
  if (sess.screencastCdp) return {}; // already streaming
  const cdp = await sess.page.context().newCDPSession(sess.page);
  sess.screencastCdp = cdp;
  cdp.on("Page.screencastFrame", async (e) => {
    try {
      writeLine({
        event: "screencast_frame",
        handle,
        data: e.data,
        width: e.metadata?.deviceWidth ?? 0,
        height: e.metadata?.deviceHeight ?? 0,
      });
      await cdp.send("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => {});
    } catch {}
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 55, everyNthFrame: 2 });
  return {};
}

export async function cmdStopScreencast({ handle }) {
  const sess = sessions.get(handle);
  const cdp = sess?.screencastCdp;
  if (cdp) {
    await cdp.send("Page.stopScreencast").catch(() => {});
    await cdp.detach().catch(() => {});
    sess.screencastCdp = null;
  }
  return {};
}


process.stderr.write("[worker] HireMeOps patchright worker ready\n");
