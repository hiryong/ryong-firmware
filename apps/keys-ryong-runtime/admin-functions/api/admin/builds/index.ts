import { AdminEnv, json } from "../../../_lib/auth";
import { BUILD_WORKFLOW, gh, ghJson, GitHubError, isGitHubError, listValidated, parseBuildTitle, ref, repo, Run, TARGETS } from "../../../_lib/github";

export interface BuildSettings {
  target: string; label: string; idle_timeout_s: number; sleep_min: number;
  debounce_press_ms: number; debounce_release_ms: number; tx_power: string;
}
export const DEFAULTS: Omit<BuildSettings, "target" | "label"> = { idle_timeout_s: 30, sleep_min: 15, debounce_press_ms: 5, debounce_release_ms: 5, tx_power: "default" };

const int = (v: unknown, min: number, max: number, name: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name}: ${min}–${max} 사이 정수여야 해요.`);
  return n;
};

/** Same limits as firmware-build.yml re-checks; never trust the browser. */
export function settingsFrom(body: unknown): BuildSettings {
  const b = (body ?? {}) as { [k: string]: unknown };
  const target = String(b.target);
  if (!(TARGETS as readonly string[]).includes(target)) throw new Error("대상 보드를 골라 주세요.");
  const label = String(b.label ?? "").trim();
  if (!/^[\w .\-가-힣]{0,40}$/.test(label)) throw new Error("이름은 40자 이내 글자·숫자·공백·-·. 만 쓸 수 있어요.");
  const s: BuildSettings = {
    target, label: label || "build",
    idle_timeout_s: int(b.idle_timeout_s ?? DEFAULTS.idle_timeout_s, 10, 3600, "유휴 판단 시간"),
    sleep_min: int(b.sleep_min ?? DEFAULTS.sleep_min, 0, 1440, "절전 시간"),
    debounce_press_ms: int(b.debounce_press_ms ?? DEFAULTS.debounce_press_ms, 1, 30, "누름 디바운스"),
    debounce_release_ms: int(b.debounce_release_ms ?? DEFAULTS.debounce_release_ms, 1, 30, "뗌 디바운스"),
    tx_power: String(b.tx_power ?? DEFAULTS.tx_power),
  };
  if (!["default", "plus4", "plus8"].includes(s.tx_power)) throw new Error("Bluetooth 출력 값이 올바르지 않아요.");
  if (s.sleep_min > 0 && s.sleep_min * 60 <= s.idle_timeout_s) throw new Error("절전 시간은 유휴 판단 시간보다 길어야 해요.");
  return s;
}

export const onRequestGet: PagesFunction<AdminEnv> = async ({ env }) => {
  const [runs, validated] = await Promise.all([
    ghJson<{ workflow_runs: Run[] }>(env, `/repos/${repo(env)}/actions/workflows/${BUILD_WORKFLOW}/runs?per_page=20&event=workflow_dispatch`)
      .catch((e) => { if (isGitHubError(e) && e.status === 404) return { workflow_runs: [] as Run[] }; throw e; }),
    listValidated(env),
  ]);
  return json({ builds: runs.workflow_runs.map((b) => ({ id: b.id, ...parseBuildTitle(b.display_title), status: b.status, conclusion: b.conclusion,
    at: b.created_at, sha: b.head_sha.slice(0, 7), url: b.html_url, validated: validated.has(b.id) })) });
};

export const onRequestPost: PagesFunction<AdminEnv> = async ({ request, env }) => {
  let s: BuildSettings;
  try { s = settingsFrom(await request.json().catch(() => null)); } catch (e) { return json({ error: (e as Error).message }, 400); }
  const req = "req-" + [...crypto.getRandomValues(new Uint8Array(5))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const inputs = Object.fromEntries(Object.entries({ ...s, request_id: req }).map(([k, v]) => [k, String(v)]));
  const r = await gh(env, `/repos/${repo(env)}/actions/workflows/${BUILD_WORKFLOW}/dispatches`, { method: "POST", body: JSON.stringify({ ref: ref(env), inputs }) });
  if (!r.ok) throw new GitHubError(r.status, `빌드를 시작하지 못했어요 (GitHub ${r.status}). ${(await r.text()).slice(0, 160)}`);
  // The dispatch API doesn't return the run; find it by the request id in its title.
  for (let i = 0; i < 6; i++) {
    await new Promise((res) => setTimeout(res, i ? 1500 : 800));
    const runs = await ghJson<{ workflow_runs: Run[] }>(env, `/repos/${repo(env)}/actions/workflows/${BUILD_WORKFLOW}/runs?per_page=10&event=workflow_dispatch`);
    const run = runs.workflow_runs.find((x) => x.display_title.endsWith(req));
    if (run) return json({ ok: true, id: run.id, url: run.html_url, request: req });
  }
  return json({ ok: true, id: null, request: req });
};
