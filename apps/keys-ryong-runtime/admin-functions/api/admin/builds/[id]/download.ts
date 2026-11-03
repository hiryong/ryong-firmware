import { AdminEnv, json } from "../../../../_lib/auth";
import { buildArtifact, gh, getRun, repo } from "../../../../_lib/github";
import { msg } from "../../../../_lib/lang";

/** Sends the browser to GitHub's short-lived download link for the build's zip (UF2 + build-info). */
export const onRequestGet: PagesFunction<AdminEnv> = async ({ request, env, params }) => {
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return json({ error: msg(request, "Invalid build number.", "잘못된 빌드 번호예요.") }, 400);
  await getRun(env, id);
  const art = await buildArtifact(env, id);
  if (!art || art.expired) return json({ error: msg(request, "The build file is missing or has expired. Build again.", "빌드 파일이 없거나 보관 기간이 지났어요. 다시 빌드하세요.") }, 404);
  const r = await gh(env, `/repos/${repo(env)}/actions/artifacts/${art.id}/zip`, { redirect: "manual" });
  const loc = r.headers.get("Location");
  if (!loc) return json({ error: msg(request, "Couldn't get a download link.", "다운로드 링크를 받지 못했어요.") }, 502);
  return new Response(null, { status: 302, headers: { Location: loc, "Cache-Control": "no-store" } });
};
