import {
  LOGIN_PROBES,
  classifyLogin,
  classifyPlatformUrl,
  sanitizeProbeError,
  sanitizeProbeUrl,
} from "../core/auth/auth-classification.js";

export { LOGIN_PROBES, classifyLogin, classifyPlatformUrl, sanitizeProbeError, sanitizeProbeUrl };

export function authStatusPlatform(platform) {
  if (platform === "linkedin_posts") return "linkedin";
  return LOGIN_PROBES[platform] ? platform : null;
}

export function classifyPageAuth(platform, page) {
  let url = "";
  try {
    url = page?.url?.() ?? "";
  } catch {}
  const authPlatform = authStatusPlatform(platform);
  return { status: authPlatform ? classifyPlatformUrl(authPlatform, url) : "valid", url };
}

export function authErrorCode(status) {
  if (status === "login_required" || status === "challenged") return status;
  return null;
}
