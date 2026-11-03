// Admin sign-in for the development site (first version: one password).
// Everything about "who is the admin" lives in this file so it can later be swapped for
// Cloudflare Access without touching the rest of the admin API.
//
// - The password exists only as a Cloudflare secret (ADMIN_PASSWORD). It never reaches the browser.
// - A successful sign-in gets an HMAC-signed, HttpOnly, SameSite=Strict cookie valid for 12 hours.
//   The signing key is derived from the password, so changing the password signs everyone out.
// - Mutating requests must also carry the X-Ryong-Admin header (blocks cross-site form posts).
// - Fails closed: with no password configured (or a short one) nobody can sign in.

export interface AdminEnv {
  ADMIN_PASSWORD?: string;
  ADMIN_GITHUB_TOKEN?: string;
  FIRMWARE_REPO?: string;
  FIRMWARE_REF?: string;
}

export const COOKIE = "ry_admin";
export const SESSION_SECONDS = 12 * 60 * 60;
export const MIN_PASSWORD = 10;
const enc = new TextEncoder();

const b64u = (b: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function hmacKey(password: string) {
  // Derive a dedicated key; the password itself is never used directly as the cookie key.
  const base = await crypto.subtle.importKey("raw", enc.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const derived = await crypto.subtle.sign("HMAC", base, enc.encode("ryong-admin-session-v1"));
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** Constant-time comparison of two strings via their SHA-256 digests. */
async function sameSecret(a: string, b: string) {
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const p = new Uint8Array(x), q = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < p.length; i++) diff |= p[i] ^ q[i];
  return diff === 0;
}

/* Secrets pasted into GitHub often carry a trailing newline or space; ignore surrounding whitespace. */
const secret = (env: AdminEnv) => (env.ADMIN_PASSWORD ?? "").trim();

export function configured(env: AdminEnv): "ok" | "no-password" | "weak-password" {
  if (!secret(env)) return "no-password";
  if (secret(env).length < MIN_PASSWORD) return "weak-password";
  return "ok";
}

export async function issue(env: AdminEnv, now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + SESSION_SECONDS;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret(env)), enc.encode(`v1.${exp}`));
  return `v1.${exp}.${b64u(sig)}`;
}

export async function verify(env: AdminEnv, value: string | null, now = Date.now()): Promise<boolean> {
  if (configured(env) !== "ok" || !value) return false;
  const m = /^v1\.(\d{1,12})\.([\w-]{43})$/.exec(value);
  if (!m || Number(m[1]) * 1000 <= now) return false;
  const expected = await issue({ ...env }, (Number(m[1]) - SESSION_SECONDS) * 1000);
  return sameSecret(expected, value);
}

export function readCookie(req: Request, name = COOKIE): string | null {
  const m = (req.headers.get("Cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; } // malformed cookie = signed out
}

export const sessionCookie = (value: string) =>
  `${COOKIE}=${encodeURIComponent(value)}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
export const clearCookie = () => `${COOKIE}=; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

// Slow down guessing. Per-isolate memory only (no database on purpose); the long password is the real defence.
const failures = new Map<string, { n: number; until: number }>();
export function lockedOut(ip: string, now = Date.now()) {
  const f = failures.get(ip);
  return !!f && f.until > now;
}
export function noteFailure(ip: string, now = Date.now()) {
  const f = failures.get(ip) ?? { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= 5) f.until = now + Math.min(15 * 60_000, 30_000 * 2 ** (f.n - 5));
  failures.set(ip, f);
  if (failures.size > 5000) failures.clear();
}
export const noteSuccess = (ip: string) => failures.delete(ip);

export async function checkPassword(env: AdminEnv, given: unknown) {
  if (configured(env) !== "ok" || typeof given !== "string" || given.length > 256) return false;
  return sameSecret(given.trim(), secret(env));
}

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
