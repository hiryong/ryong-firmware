import { AdminEnv, json } from "../../_lib/auth";
import { buildArtifact, getRun, gh, GitHubError, readRecord, ref, releasedChannels, RELEASE_WORKFLOW, repo } from "../../_lib/github";
import { Channel, releaseBlockers } from "../../_lib/rules";
import { langOf, msg } from "../../_lib/lang";

/** Asks the release workflow to publish a validated build. The workflow re-checks every rule itself. */
export const onRequestPost: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const body = (await request.json().catch(() => ({}))) as { run_id?: unknown; channel?: unknown };
  const id = Number(body.run_id), channel = body.channel as Channel;
  if (!Number.isSafeInteger(id) || id <= 0 || (channel !== "beta" && channel !== "stable")) return json({ error: msg(request, "Invalid request.", "요청이 올바르지 않아요.") }, 400);
  const run = await getRun(env, id);
  const art = run.conclusion === "success" ? await buildArtifact(env, id) : null;
  const rec = await readRecord(env, id);
  const released = art ? await releasedChannels(env, id, art.target) : [];
  const why = releaseBlockers(channel, { conclusion: run.conclusion ?? run.status, target: art?.target ?? "", uf2_sha256: art?.uf2_sha256 }, rec?.data ?? null, released, langOf(request));
  if (art?.expired) why.push(msg(request, "The build file has expired. Build again and test again.", "빌드 파일 보관 기간이 지났어요. 다시 빌드하고 다시 검증하세요."));
  if (why.length) return json({ error: msg(request, "Can't release.", "배포할 수 없어요."), blockers: why }, 409);
  const r = await gh(env, `/repos/${repo(env)}/actions/workflows/${RELEASE_WORKFLOW}/dispatches`, {
    method: "POST", body: JSON.stringify({ ref: ref(env), inputs: { build_run_id: String(id), channel } }) });
  if (!r.ok) throw new GitHubError(r.status, `배포를 시작하지 못했어요 (GitHub ${r.status}).`, `Couldn't start the release (GitHub ${r.status}).`);
  return json({ ok: true });
};
