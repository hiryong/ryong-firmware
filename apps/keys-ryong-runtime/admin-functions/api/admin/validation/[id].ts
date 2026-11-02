import { AdminEnv, json } from "../../../_lib/auth";
import { buildArtifact, getRun, readRecord, writeRegistry } from "../../../_lib/github";
import { sanitize } from "../../../_lib/rules";

/** Saves the bench-test record for one build to the firmware-registry branch (git keeps the history). */
export const onRequestPut: PagesFunction<AdminEnv> = async ({ request, env, params }) => {
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return json({ error: "잘못된 빌드 번호예요." }, 400);
  const run = await getRun(env, id);
  if (run.conclusion !== "success") return json({ error: "성공한 빌드만 검증 기록을 남길 수 있어요." }, 409);
  const art = await buildArtifact(env, id);
  if (!art) return json({ error: "빌드 파일 정보를 찾지 못했어요." }, 409);
  let record;
  try {
    record = sanitize(await request.json().catch(() => null), { run_id: id, target: art.target, uf2_sha256: art.uf2_sha256 }, "admin");
  } catch (e) { return json({ error: (e as Error).message }, 400); }
  const prev = await readRecord(env, id);
  await writeRegistry(env, `validation/${id}.json`, record, `validation: r${id} ${record.target} → ${record.result}`, prev?.sha);
  return json({ ok: true, record });
};
