import { cookie, seal } from "../../_lib/session";

// Start GitHub sign-in. ?return=/path brings the person back where they were.
export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const url = new URL(request.url);
  const ret = url.searchParams.get("return") || "/";
  const state = crypto.randomUUID();
  const sealed = await seal({ state, ret: ret.startsWith("/") ? ret : "/" }, env.SESSION_SECRET);
  const gh = new URL("https://github.com/login/oauth/authorize");
  gh.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  gh.searchParams.set("redirect_uri", `${url.origin}/api/auth/callback`);
  gh.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: { Location: gh.toString(), "Set-Cookie": cookie("ry_state", sealed, 600), "Cache-Control": "no-store" },
  });
};
