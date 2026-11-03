import { AdminEnv, checkPassword, configured, issue, json, lockedOut, noteFailure, noteSuccess, sessionCookie } from "../../_lib/auth";
import { msg } from "../../_lib/lang";

export const onRequestPost: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const state = configured(env);
  if (state !== "ok") return json({ error: state === "no-password" ? msg(request, "No admin password is set yet.", "관리자 비밀번호가 아직 설정되지 않았어요.")
    : msg(request, "The configured password is too short (10+ characters).", "설정된 비밀번호가 너무 짧아요 (10자 이상).") }, 503);
  if (lockedOut(ip)) return json({ error: msg(request, "Too many wrong attempts. Try again in a little while.", "여러 번 틀려서 잠시 막혔어요. 조금 뒤에 다시 시도하세요.") }, 429);
  const body = (await request.json().catch(() => ({}))) as { password?: unknown };
  if (!(await checkPassword(env, body.password))) {
    noteFailure(ip);
    await new Promise((r) => setTimeout(r, 400));
    return json({ error: msg(request, "Wrong password.", "비밀번호가 맞지 않아요.") }, 401);
  }
  noteSuccess(ip);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(await issue(env)) });
};
