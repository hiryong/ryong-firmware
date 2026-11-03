// Every /api/admin/* request passes here. Only sign-in and the setup check are open.
import { AdminEnv, json, readCookie, verify } from "../../_lib/auth";
import { isGitHubError } from "../../_lib/github";
import { errText, langOf, msg } from "../../_lib/lang";

const OPEN = new Set(["/api/admin/login", "/api/admin/me"]);

export const onRequest: PagesFunction<AdminEnv> = async ({ request, env, next }) => {
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  if (request.method !== "GET" && request.method !== "HEAD" && request.headers.get("X-Ryong-Admin") !== "1")
    return json({ error: msg(request, "Malformed request.", "요청 형식이 올바르지 않아요.") }, 400);
  if (!OPEN.has(path) && !(await verify(env, readCookie(request))))
    return json({ error: msg(request, "Please sign in.", "로그인이 필요해요.") }, 401);
  try {
    return await next();
  } catch (e) {
    if (isGitHubError(e)) return json({ error: errText(e, langOf(request)) }, e.status === 401 || e.status === 403 ? 502 : e.status >= 500 ? 502 : e.status);
    return json({ error: errText(e, langOf(request)) || msg(request, "Unknown error", "알 수 없는 오류") }, 500);
  }
};
