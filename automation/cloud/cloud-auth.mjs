import {
  classifyLinkedInAuth,
  LOGIN_PROBES,
  classifyLogin,
  classifyPlatformUrl,
  sanitizeProbeError,
  sanitizeProbeUrl,
} from "../core/auth/auth-classification.js";
import { inspectLinkedInAuthDocument } from "../platforms/linkedin/linkedin-search-dom.js";

export {
  LOGIN_PROBES,
  classifyLinkedInAuth,
  classifyLogin,
  classifyPlatformUrl,
  sanitizeProbeError,
  sanitizeProbeUrl,
};

export function authStatusPlatform(platform) {
  if (platform === "linkedin_posts") return "linkedin";
  return LOGIN_PROBES[platform] ? platform : null;
}

export async function classifyPageAuth(platform, page) {
  let url = "";
  try {
    url = page?.url?.() ?? "";
  } catch {}
  const authPlatform = authStatusPlatform(platform);
  if (authPlatform !== "linkedin") {
    return { status: authPlatform ? classifyPlatformUrl(authPlatform, url) : "valid", url };
  }
  let markers = {};
  try {
    markers = (await page?.evaluate?.(inspectLinkedInAuthDocument)) ?? {};
  } catch {}
  return {
    status: classifyLinkedInAuth({ url, ...markers }),
    url,
    ...markers,
  };
}

export function authErrorCode(status) {
  if (status === "login_required" || status === "challenged") return status;
  return null;
}
