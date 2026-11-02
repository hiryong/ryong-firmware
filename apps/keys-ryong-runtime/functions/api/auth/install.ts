import { cookie, seal } from "../../_lib/session";

// Choose which repositories this site may use (installs the GitHub App). GitHub returns to the
// callback with a sign-in code, carrying the same state, so the flow stays protected.
export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const url = new URL(request.url);
  const ret = url.searchParams.get("return") || "/";
  const state = crypto.randomUUID();
  const sealed = await seal({ state, ret: ret.startsWith("/") ? ret : "/" }, env.SESSION_SECRET);
  const gh = new URL(`https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`);
  gh.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: { Location: gh.toString(), "Set-Cookie": cookie("ry_state", sealed, 1800), "Cache-Control": "no-store" },
  });
};
