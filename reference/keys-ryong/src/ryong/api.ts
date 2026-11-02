// Talking to GitHub, two ways:
// - signed in: through this site's /api (functions/), which holds the person's GitHub token in a sealed
//   HttpOnly cookie. The page itself never sees a token.
// - not signed in: public repositories only, read straight from GitHub.

import { useEffect, useState } from "react";

export interface Me {
  /** false until the site's GitHub App is configured */
  enabled: boolean;
  app: string | null;
  user: { login: string; name: string | null; avatar: string; owner: boolean } | null;
  /** repositories the person let this site use */
  repos: { full_name: string; private: boolean; default_branch: string }[];
}

const EMPTY: Me = { enabled: false, app: null, user: null, repos: [] };

// One shared copy of "who am I", so every part of the page agrees.
let current: Me | null = null;
let loading: Promise<Me> | null = null;
const listeners = new Set<(m: Me) => void>();

export function refreshMe(): Promise<Me> {
  loading = fetch("/api/me", { credentials: "same-origin", cache: "no-store" })
    .then((r) => (r.ok && (r.headers.get("Content-Type") || "").includes("json") ? r.json() : EMPTY))
    .catch(() => EMPTY)
    .then((m: Me) => {
      current = { ...EMPTY, ...m, repos: m.repos || [] };
      listeners.forEach((l) => l(current!));
      return current;
    });
  return loading;
}

export function useMe(): Me & { loading: boolean } {
  const [me, setMe] = useState<Me | null>(current);
  useEffect(() => {
    listeners.add(setMe);
    if (!current && !loading) refreshMe();
    else if (!current && loading) loading.then(setMe);
    return () => {
      listeners.delete(setMe);
    };
  }, []);
  return { ...(me || EMPTY), loading: !me };
}

const here = () => location.pathname + location.search;
const RESUME = "ryong.resumeTab";
/** Remember which panel tab to reopen after the GitHub round trip. */
const leaving = () => {
  try {
    const t = document.querySelector<HTMLElement>("dialog.ry-hub[open] .ry-tab[aria-pressed='true']")?.dataset.tab;
    if (t) sessionStorage.setItem(RESUME, t);
  } catch {
    /* no storage */
  }
};
export const signIn = () => {
  leaving();
  location.href = `/api/auth/login?return=${encodeURIComponent(here())}`;
};
export const chooseRepos = () => {
  leaving();
  location.href = `/api/auth/install?return=${encodeURIComponent(here())}`;
};

/** Back from GitHub: which tab to reopen, and whether sign-in failed. Reads and clears both once. */
export function takeReturn(): { tab: string | null; failed: boolean } {
  const failed = location.hash === "#signin-error";
  const back = failed || location.hash === "#signed-in";
  if (back) history.replaceState(null, "", location.pathname + location.search);
  let tab: string | null = null;
  try {
    tab = sessionStorage.getItem(RESUME);
    sessionStorage.removeItem(RESUME);
  } catch {
    /* no storage */
  }
  return { tab: back ? tab || "firmware" : null, failed };
}

/** Set once when the page loads after a failed sign-in; the sign-in card shows it. */
export let signInFailed = false;
export const markSignInFailed = () => (signInFailed = true);
export async function signOut() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  await refreshMe();
}

// ---------- GitHub calls ----------

async function gh<T>(path: string, init: RequestInit = {}): Promise<T> {
  const signedIn = !!current?.user;
  const url = signedIn ? `/api/gh${path}` : `https://api.github.com${path}`;
  const r = await fetch(url, {
    ...init,
    credentials: signedIn ? "same-origin" : "omit",
    headers: { Accept: "application/vnd.github+json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (!r.ok) {
    let msg = `${r.status}`;
    try {
      msg = (await r.json()).message || msg;
    } catch {
      /* not json */
    }
    if (r.status === 401) msg = "Your sign-in has expired. Sign in again.";
    else if (/rate limit/i.test(msg)) msg = "GitHub is busy for this network. Try again in a few minutes, or sign in.";
    else if (r.status === 403 || r.status === 404) msg = `GitHub said “${msg}”. The site may not have access to this repository.`;
    throw new Error(msg);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}
export { gh };

const decode = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, "")), (c) => c.charCodeAt(0)));

/** A file's text, or null when it doesn't exist. */
export async function readFile(repo: string, branch: string, path: string): Promise<string | null> {
  if (!current?.user) {
    // Public repositories, no sign-in: raw files (no API rate limit).
    const r = await fetch(`https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}/${path}?t=${Date.now()}`, { cache: "no-store" });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Couldn't read ${path} (${r.status}).`);
    return r.text();
  }
  try {
    const f = await gh<{ content: string }>(`/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`);
    return decode(f.content);
  } catch (e) {
    if (/Not Found|404/.test((e as Error).message)) return null;
    throw e;
  }
}

/** Writes all files as one commit on the branch. Returns the commit's web URL. */
export async function commitFiles(repo: string, branch: string, files: { path: string; content: string }[], message: string): Promise<string> {
  const ref = await gh<{ object: { sha: string } }>(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const parent = ref.object.sha;
  const commit = await gh<{ tree: { sha: string } }>(`/repos/${repo}/git/commits/${parent}`);
  const tree = await gh<{ sha: string }>(`/repos/${repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: commit.tree.sha, tree: files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content })) }),
  });
  const created = await gh<{ sha: string; html_url: string }>(`/repos/${repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: tree.sha, parents: [parent] }),
  });
  await gh(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { method: "PATCH", body: JSON.stringify({ sha: created.sha }) });
  return created.html_url;
}

export const listBranches = (repo: string) =>
  gh<{ name: string }[]>(`/repos/${repo}/branches?per_page=100`).then((b) => b.map((x) => x.name));

export const listTree = (repo: string, branch: string) =>
  gh<{ tree: { path: string; type: string }[] }>(`/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`).then((t) =>
    t.tree.filter((x) => x.type === "blob").map((x) => x.path)
  );

export interface Run {
  status: string;
  conclusion: string | null;
  updated_at: string;
  html_url: string;
}
export const latestRun = (repo: string, workflow: string, branch: string) =>
  gh<{ workflow_runs?: Run[] }>(`/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?branch=${encodeURIComponent(branch)}&per_page=1`).then(
    (d) => d.workflow_runs?.[0] ?? null
  );
