import { AdminEnv, json } from "../../../_lib/auth";
import { buildArtifact, getRun, parseBuildTitle, readRecord, releasedChannels } from "../../../_lib/github";
import { ITEMS, BOARDS, releaseBlockers } from "../../../_lib/rules";
import { langOf, msg } from "../../../_lib/lang";

export const onRequestGet: PagesFunction<AdminEnv> = async ({ request, env, params }) => {
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return json({ error: msg(request, "Invalid build number.", "잘못된 빌드 번호예요.") }, 400);
  const run = await getRun(env, id);
  const t = parseBuildTitle(run.display_title);
  const [art, rec] = await Promise.all([run.conclusion === "success" ? buildArtifact(env, id) : Promise.resolve(null), readRecord(env, id)]);
  const target = art?.target ?? t?.target ?? "";
  const released = target ? await releasedChannels(env, id, target) : [];
  const lang = langOf(request);
  const build = { conclusion: run.conclusion ?? run.status, target, uf2_sha256: art?.uf2_sha256 };
  return json({
    id, ...t, target, status: run.status, conclusion: run.conclusion, url: run.html_url, at: run.created_at, sha: run.head_sha,
    artifact: art, record: rec?.data ?? null, released,
    blockers: { beta: releaseBlockers("beta", build, rec?.data ?? null, released, lang), stable: releaseBlockers("stable", build, rec?.data ?? null, released, lang) },
    checklist: { items: ITEMS, boards: BOARDS },
  });
};
