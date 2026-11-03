import { AdminEnv, json } from "../../_lib/auth";
import { msg } from "../../_lib/lang";
import { BUILD_WORKFLOW, ghJson, parseBuildTitle, readChannels, readRegistry, ref, repo, Run } from "../../_lib/github";

const CHECKS: [file: string, en: string, ko: string][] = [
  ["runtime-client-validation.yml", "Web app and virtual keyboard tests", "웹앱·가상 키보드 테스트"],
  ["bt60-validation.yml", "BT60 firmware compile", "BT60 펌웨어 컴파일"],
  ["zmk-validation.yml", "Ryong60 firmware compile", "Ryong60 펌웨어 컴파일"],
  ["host-tests.yml", "Firmware module unit tests", "펌웨어 모듈 단위 테스트"],
  ["updater-validation.yml", "Updater tests", "업데이트 검증 테스트"],
  ["keys-deploy.yml", "keys deploy", "keys.ryong.com 배포"],
];

export const onRequestGet: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const r = repo(env), branch = encodeURIComponent(ref(env));
  const [checks, builds, channels, zmk] = await Promise.all([
    Promise.all(CHECKS.map(async ([file, en, ko]) => {
      const label = msg(request, en, ko);
      const x = await ghJson<{ workflow_runs: Run[] }>(env, `/repos/${r}/actions/workflows/${file}/runs?branch=${branch}&per_page=1`).catch(() => null);
      const run = x?.workflow_runs[0];
      return { file, label, status: run?.status ?? "none", conclusion: run?.conclusion ?? null, url: run?.html_url ?? null,
        at: run?.created_at ?? null, sha: run?.head_sha?.slice(0, 7) ?? null };
    })),
    ghJson<{ workflow_runs: Run[] }>(env, `/repos/${r}/actions/workflows/${BUILD_WORKFLOW}/runs?per_page=5&event=workflow_dispatch`).catch(() => ({ workflow_runs: [] as Run[] })),
    readChannels(env),
    // Written by the weekly ZMK release check (third_party/zmk/README.md): official release + our modules, prepared and judged.
    readRegistry<unknown>(env, "zmk-update.json").then((x) => x?.data ?? null).catch(() => null),
  ]);
  return json({
    checks,
    builds: builds.workflow_runs.map((b) => ({ id: b.id, ...parseBuildTitle(b.display_title), status: b.status, conclusion: b.conclusion, at: b.created_at, url: b.html_url })),
    channels,
    zmk,
  });
};
