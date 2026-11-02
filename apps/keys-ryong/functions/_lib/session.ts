// Session = the signed-in user's GitHub token, sealed (AES-GCM) in an HttpOnly cookie.
// No database: the cookie is the session. Page scripts can never read the token.

export interface Session {
  login: string;
  token: string;
  /** ms epoch; 0 = never expires */
  exp: number;
  refresh?: string;
}

const COOKIE = "ry_s";
const enc = new TextEncoder();
const dec = new TextDecoder();

async function key(secret: string) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export async function seal(data: unknown, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), enc.encode(JSON.stringify(data))));
  return `${b64u(iv)}.${b64u(ct)}`;
}

export async function unseal<T>(value: string, secret: string): Promise<T | null> {
  try {
    const [iv, ct] = value.split(".");
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv) }, await key(secret), unb64u(ct));
    return JSON.parse(dec.decode(pt)) as T;
  } catch {
    return null;
  }
}

export function readCookie(req: Request, name: string): string | null {
  const m = (req.headers.get("Cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

const MONTH = 60 * 60 * 24 * 30;

export async function sessionCookie(s: Session, secret: string) {
  return cookie(COOKIE, await seal(s, secret), 6 * MONTH);
}
export const clearSession = () => cookie(COOKIE, "", 0);

/** Token exchange with GitHub (code or refresh token). */
export async function exchange(env: Env, params: Record<string, string>) {
  const r = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, ...params }),
  });
  const j = (await r.json()) as { access_token?: string; expires_in?: number; refresh_token?: string; error?: string };
  if (!j.access_token) throw new Error(j.error || "token exchange failed");
  return { token: j.access_token, exp: j.expires_in ? Date.now() + j.expires_in * 1000 : 0, refresh: j.refresh_token };
}

/**
 * The current session, refreshed when its token is about to expire.
 * setCookie is non-null when the caller must send an updated cookie back.
 */
export async function getSession(req: Request, env: Env): Promise<{ s: Session | null; setCookie: string | null }> {
  const raw = readCookie(req, COOKIE);
  if (!raw) return { s: null, setCookie: null };
  const s = await unseal<Session>(raw, env.SESSION_SECRET);
  if (!s) return { s: null, setCookie: clearSession() };
  if (s.exp && s.exp - Date.now() < 5 * 60 * 1000) {
    if (!s.refresh) return { s: null, setCookie: clearSession() };
    try {
      const t = await exchange(env, { grant_type: "refresh_token", refresh_token: s.refresh });
      const next = { ...s, token: t.token, exp: t.exp, refresh: t.refresh || s.refresh };
      return { s: next, setCookie: await sessionCookie(next, env.SESSION_SECRET) };
    } catch {
      return { s: null, setCookie: clearSession() };
    }
  }
  return { s, setCookie: null };
}

export function json(data: unknown, init: ResponseInit = {}, setCookie?: string | null) {
  const h = new Headers(init.headers);
  h.set("Content-Type", "application/json");
  h.set("Cache-Control", "no-store");
  if (setCookie) h.append("Set-Cookie", setCookie);
  return new Response(JSON.stringify(data), { ...init, headers: h });
}

export const gh = (path: string, token: string, init: RequestInit = {}) =>
  fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "keys.ryong.com",
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
