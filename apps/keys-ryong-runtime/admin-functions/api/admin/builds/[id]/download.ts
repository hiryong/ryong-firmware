import { AdminEnv, json } from "../../../../_lib/auth";
import { buildArtifact, gh, getRun, repo } from "../../../../_lib/github";
import { msg } from "../../../../_lib/lang";
import { listZip, readZipEntry } from "../../../../_lib/unzip";

/** Hands out one file of the build: ?file=uf2 (USB install) or ?file=ble (Bluetooth package).
 *  Without ?file it still redirects to GitHub's zip of everything (browsers may flag that zip). */
export const onRequestGet: PagesFunction<AdminEnv> = async ({ request, env, params }) => {
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return json({ error: msg(request, "Invalid build number.", "잘못된 빌드 번호예요.") }, 400);
  await getRun(env, id);
  const art = await buildArtifact(env, id);
  if (!art || art.expired) return json({ error: msg(request, "The build file is missing or has expired. Build again.", "빌드 파일이 없거나 보관 기간이 지났어요. 다시 빌드하세요.") }, 404);
  const r = await gh(env, `/repos/${repo(env)}/actions/artifacts/${art.id}/zip`, { redirect: "manual" });
  const loc = r.headers.get("Location");
  if (!loc) return json({ error: msg(request, "Couldn't get a download link.", "다운로드 링크를 받지 못했어요.") }, 502);
  const want = new URL(request.url).searchParams.get("file");
  if (want !== "uf2" && want !== "ble") return new Response(null, { status: 302, headers: { Location: loc, "Cache-Control": "no-store" } });

  const z = await fetch(loc);
  if (!z.ok) return json({ error: msg(request, "Couldn't download the build from GitHub.", "GitHub에서 빌드를 받지 못했어요.") }, 502);
  const zip = new Uint8Array(await z.arrayBuffer());
  const entry = listZip(zip).find((e) => (want === "uf2" ? /\.uf2$/ : /-bluetooth\.zip$/).test(e.name) && !e.name.includes("/"));
  if (!entry) return json({ error: msg(request, "This build has no such file.", "이 빌드에는 그 파일이 없어요.") }, 404);
  const body = await readZipEntry(zip, entry);
  const name = entry.name.replace(/[^\w.\-]/g, "_");
  return new Response(body, { headers: {
    "Content-Type": want === "uf2" ? "application/octet-stream" : "application/zip",
    "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
};
