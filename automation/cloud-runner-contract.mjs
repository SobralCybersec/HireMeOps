import { createDecipheriv, createCipheriv, randomBytes } from "node:crypto";

export const STORAGE_STATE_VERSION = 1;
export const ENCRYPTION_VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const COMMANDS = new Set([
  "search_jobs",
  "search_linkedin_posts",
  "search_google",
  "search_indeed_jobs",
  "catho_search_jobs",
  "search_gupy_jobs",
  "infojobs_search_jobs",
  "upwork_search_jobs",
  "freelas99_search_jobs",
  "programathor_search_jobs",
  "geekhunter_search_jobs",
  "catho_apply",
  "infojobs_apply",
]);
const DEFAULT_COMMANDS = {
  linkedin: "search_jobs",
  linkedin_posts: "search_linkedin_posts",
  google: "search_google",
  indeed: "search_indeed_jobs",
  catho: "catho_search_jobs",
  gupy: "search_gupy_jobs",
  infojobs: "infojobs_search_jobs",
  upwork: "upwork_search_jobs",
  freelas99: "freelas99_search_jobs",
  programathor: "programathor_search_jobs",
  geekhunter: "geekhunter_search_jobs",
};

export class CloudRunnerError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function summarizePlatformStatus(platformStatus) {
  const values = Object.values(platformStatus ?? {});
  if (values.includes("challenged")) return "challenged";
  if (values.includes("valid")) return "valid";
  if (values.includes("login_required")) return "login_required";
  return "unknown";
}

export function buildOperationRequest(plan, handle) {
  const command = plan?.command ?? DEFAULT_COMMANDS[plan?.platform];
  if (!COMMANDS.has(command)) throw new CloudRunnerError("unsupported_operation");
  const args = plan?.args && typeof plan.args === "object" ? { ...plan.args } : {};
  return { ...args, cmd: command, handle };
}

function decodeKey(value) {
  const encoded = String(value ?? "").trim();
  let bytes;
  try {
    if (encoded.startsWith("hex:")) bytes = Buffer.from(encoded.slice(4), "hex");
    else if (encoded.startsWith("base64:")) bytes = Buffer.from(encoded.slice(7), "base64");
    else if (/^[0-9a-f]{64}$/i.test(encoded)) bytes = Buffer.from(encoded, "hex");
    else bytes = Buffer.from(encoded, "base64");
  } catch {
    throw new CloudRunnerError("invalid_session_encryption_key");
  }
  if (bytes.length !== 32) throw new CloudRunnerError("invalid_session_encryption_key");
  return bytes;
}

export function decryptSessionState(encryptedState, encodedKey) {
  const bytes = Buffer.from(encryptedState ?? []);
  if (bytes.length <= NONCE_BYTES + TAG_BYTES)
    throw new CloudRunnerError("corrupted_session_ciphertext");
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      decodeKey(encodedKey),
      bytes.subarray(0, NONCE_BYTES),
    );
    decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
    const plaintext = Buffer.concat([
      decipher.update(bytes.subarray(NONCE_BYTES, bytes.length - TAG_BYTES)),
      decipher.final(),
    ]);
    const state = JSON.parse(plaintext.toString("utf8"));
    if (!state || !Array.isArray(state.cookies) || !Array.isArray(state.origins)) {
      throw new CloudRunnerError("invalid_storage_state");
    }
    return state;
  } catch (error) {
    if (error instanceof CloudRunnerError) throw error;
    throw new CloudRunnerError("session_decryption_failed");
  }
}

export function encryptSessionState(state, encodedKey) {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", decodeKey(encodedKey), nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
}
