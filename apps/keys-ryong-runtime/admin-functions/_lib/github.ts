// Server-side GitHub access for the admin API. The token (ADMIN_GITHUB_TOKEN) is a fine-grained
// token limited to the firmware repository; it never leaves Cloudflare.
import type { AdminEnv } from "./auth";
import type { Channel, ValidationRecord } from "./rules";

export const REGISTRY = "firmware-registry";
export const BUILD_WORKFLOW = "firmware-build.yml";
export const RELEASE_WORKFLOW = "firmware-release.yml";
export const TARGETS = ["bt60", "bt60-oreo", "ryong60"] as const;

export const repo = (env: AdminEnv) => env.FIRMWARE_REPO || "hiryong/ryong-firmware";
export const ref = (env: AdminEnv) => env.FIRMWARE_REF || "dev/keys-ryong-runtime";

export const isGitHubError = (e: unknown): e is GitHubError => !!e && (e as Error).name === "GitHubError" && typeof (e as GitHubError).status === "number";
export class GitHubError extends Error {
  /** `message` is Korean; `en` (optional) is the same text in English for pages that ask for it. */
  constructor(public status: number, message: string, public en?: string) { super(message); this.name = "GitHubError"; }
}

export async function gh(env: AdminEnv, path: string, init: RequestInit = {}): Promise<Response> {
  if (!env.ADMIN_GITHUB_TOKEN) throw new GitHubError(503, "GitHub 토큰(ADMIN_GITHUB_TOKEN)이 설정되지 않았어요.", "The GitHub token (ADMIN_GITHUB_TOKEN) is not set.");
  if (!path.startsWith("/")) throw new GitHubError(500, "잘못된 GitHub 요청이에요.", "Bad GitHub request."); // the token only ever goes to api.github.com
  const url = `https://api.github.com${path}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.ADMIN_GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ryong-keys-admin",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  return r;
}

export async function ghJson<T>(env: AdminEnv, path: string, init: RequestInit = {}): Promise<T> {
  const r = await gh(env, path, init);
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new GitHubError(r.status, `GitHub ${r.status}: ${text.slice(0, 200)}`);
  }
  return (r.status === 204 ? null : await r.json()) as T;
}

export interface Run {
  id: number; name: string; display_title: string; status: string; conclusion: string | null;
  html_url: string; created_at: string; updated_at: string; head_sha: string; head_branch: string; path?: string; event?: string;
}

/** "Firmware build · bt60 · label · req-xxxx" (run-name set by firmware-build.yml) */
export function parseBuildTitle(title: string) {
  const m = /^Firmware build · (bt60-oreo|bt60|ryong60) · (.*?) · (req-[\w-]+)$/.exec(title);
  return m ? { target: m[1], label: m[2], request: m[3] } : null;
}

/** Artifact name carries the target and the UF2's SHA-256 (the release workflow re-checks the file). */
export function parseArtifact(name: string) {
  const m = /^firmware-(bt60-oreo|bt60|ryong60)-([0-9a-f]{64})$/.exec(name);
  return m ? { target: m[1], uf2_sha256: m[2] } : null;
}

export async function buildArtifact(env: AdminEnv, runId: number) {
  const a = await ghJson<{ artifacts: { id: number; name: string; expired: boolean; size_in_bytes: number; expires_at: string }[] }>(
    env, `/repos/${repo(env)}/actions/runs/${runId}/artifacts?per_page=50`);
  for (const art of a.artifacts) {
    const p = parseArtifact(art.name);
    if (p) return { ...p, id: art.id, expired: art.expired, size: art.size_in_bytes, expires_at: art.expires_at };
  }
  return null;
}

const b64decode = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
const b64encode = (s: string) => { const b = new TextEncoder().encode(s); let x = ""; for (const c of b) x += String.fromCharCode(c); return btoa(x); };

export async function readRegistry<T>(env: AdminEnv, path: string): Promise<{ data: T; sha: string } | null> {
  const r = await gh(env, `/repos/${repo(env)}/contents/${path}?ref=${REGISTRY}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new GitHubError(r.status, `기록 저장소를 읽지 못했어요 (${r.status}).`, `Couldn't read the record store (${r.status}).`);
  const f = (await r.json()) as { content: string; sha: string };
  return { data: JSON.parse(b64decode(f.content)) as T, sha: f.sha };
}

export async function writeRegistry(env: AdminEnv, path: string, data: unknown, message: string, sha?: string) {
  return ghJson(env, `/repos/${repo(env)}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({ message, branch: REGISTRY, content: b64encode(JSON.stringify(data, null, 2) + "\n"), ...(sha ? { sha } : {}) }),
  });
}

export async function listValidated(env: AdminEnv): Promise<Set<number>> {
  const r = await gh(env, `/repos/${repo(env)}/contents/validation?ref=${REGISTRY}`);
  if (r.status === 404) return new Set();
  if (!r.ok) throw new GitHubError(r.status, `기록 저장소를 읽지 못했어요 (${r.status}).`, `Couldn't read the record store (${r.status}).`);
  const list = (await r.json()) as { name: string }[];
  return new Set(list.map((f) => Number(/^(\d+)\.json$/.exec(f.name)?.[1])).filter(Boolean));
}

export type Channels = { [target: string]: { [ch in Channel]?: { run_id: number; tag: string; uf2_sha256: string; released_at: string; url: string } } };
export async function readChannels(env: AdminEnv): Promise<Channels> {
  return (await readRegistry<Channels>(env, "channels.json"))?.data ?? {};
}
export async function readRecord(env: AdminEnv, runId: number) {
  return readRegistry<ValidationRecord>(env, `validation/${runId}.json`);
}

export async function releasedChannels(env: AdminEnv, runId: number, target: string): Promise<Channel[]> {
  const out: Channel[] = [];
  for (const ch of ["beta", "stable"] as Channel[]) {
    const r = await gh(env, `/repos/${repo(env)}/releases/tags/fw-${target}-${ch}-r${runId}`);
    if (r.ok) out.push(ch);
  }
  return out;
}

export async function getRun(env: AdminEnv, runId: number) {
  const run = await ghJson<Run>(env, `/repos/${repo(env)}/actions/runs/${runId}`);
  if (!run.path?.endsWith(`/${BUILD_WORKFLOW}`) || run.event !== "workflow_dispatch") throw new GitHubError(404, "관리 페이지에서 만든 펌웨어 빌드가 아니에요.", "This is not a firmware build made from the admin page.");
  return run;
}
