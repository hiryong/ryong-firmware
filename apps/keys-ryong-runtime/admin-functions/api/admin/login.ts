import { AdminEnv, checkPassword, configured, issue, json, lockedOut, noteFailure, noteSuccess, sessionCookie } from "../../_lib/auth";

export const onRequestPost: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const state = configured(env);
  if (state !== "ok") return json({ error: state === "no-password" ? "관리자 비밀번호가 아직 설정되지 않았어요." : "설정된 비밀번호가 너무 짧아요 (12자 이상)." }, 503);
  if (lockedOut(ip)) return json({ error: "여러 번 틀려서 잠시 막혔어요. 조금 뒤에 다시 시도하세요." }, 429);
  const body = (await request.json().catch(() => ({}))) as { password?: unknown };
  if (!(await checkPassword(env, body.password))) {
    noteFailure(ip);
    await new Promise((r) => setTimeout(r, 400));
    return json({ error: "비밀번호가 맞지 않아요." }, 401);
  }
  noteSuccess(ip);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(await issue(env)) });
};
