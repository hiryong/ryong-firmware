import { clearSession, cookie, exchange, gh, readCookie, sessionCookie, unseal } from "../../_lib/session";

// GitHub sends the person back here after sign-in (and after installing the app on repositories).
export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const st = await unseal<{ state: string; ret: string }>(readCookie(request, "ry_state") || "", env.SESSION_SECRET);
  const back = (path: string, extra: string[] = []) => {
    const h = new Headers({ Location: path, "Cache-Control": "no-store" });
    h.append("Set-Cookie", cookie("ry_state", "", 0));
    extra.forEach((c) => h.append("Set-Cookie", c));
    return new Response(null, { status: 302, headers: h });
  };

  // Repositories changed on GitHub without a sign-in round trip: just go back, the page re-checks.
  if (!code) return back(st?.ret || "/");
  // Only accept codes from flows this site started (login or install both carry our state).
  if (!st || st.state !== url.searchParams.get("state")) return back("/#signin-error");
  try {
    const t = await exchange(env, { code });
    const u = (await (await gh("/user", t.token)).json()) as { login?: string };
    if (!u.login) throw new Error("no user");
    return back(`${st?.ret || "/"}#signed-in`, [await sessionCookie({ login: u.login, ...t }, env.SESSION_SECRET)]);
  } catch {
    return back("/#signin-error", [clearSession()]);
  }
};
