// Keyboards the site knows about:
// - the shared list (public/catalog.json in this site's repository): firmware anyone can download
// - "my keyboards": each signed-in person's own list, kept as keys-ryong.json in their own config
//   repository, so it follows them to any computer and needs no database here.

import { useEffect, useState } from "react";
import { commitFiles, Me, readFile } from "./api";

export interface Board {
  id: string;
  name: string;
  note: string;
  /** GitHub config repository and branch that build this keyboard's firmware */
  repo: string;
  branch: string;
  workflow: string;
  artifact: string;
  /** the .keymap file (combos & macros live next to it) */
  keymap: string;
  /** shown as connected when the keyboard reports a name containing one of these */
  match: string[];
  unlockKey?: string;
  bootloaderKey?: string;
  /** how it turns off and back on, e.g. "Fn + Space, hold 3 s" — shown on the card and next to Soft Off */
  powerKey?: string;
  /** key layout for the combo picker when the keyboard isn't connected (see behaviors/layouts.ts) */
  layout?: string;
  /** set at load time */
  private?: boolean;
  /**
   * The repository whose keys-ryong.json lists this keyboard. Copies of that repository (templates, forks)
   * carry the file along, but their copy of the entry is ignored, so a copy starts with an empty list.
   */
  onlyIn?: string;
  /**
   * Shared keyboards only: a GitHub template repository people copy to get a config of their own
   * (their own firmware builds, combos and macros). Its default branch builds this keyboard.
   */
  template?: {
    repo: string;
    keymap: string;
    workflow?: string;
    /** the base layer is for this OS, and layer `layer` holds the other one's keys (switched with Fn + Tab) */
    os?: { base: "windows" | "mac"; layer: number };
  };
}

export const SITE = { repo: "hiryong/keys-ryong", branch: "main", catalog: "public/catalog.json" };
export const MY_FILE = "keys-ryong.json";

export const matchesDevice = (k: Board, deviceName?: string) =>
  !!deviceName && k.match.some((m) => !!m && deviceName.toLowerCase().includes(m.toLowerCase()));

const enc = (s: string) => encodeURIComponent(s);

export const links = (k: Board) => ({
  /** latest successful build: public repos via nightly.link, private ones through this site */
  firmware: k.private
    ? `/api/firmware?repo=${enc(k.repo)}&branch=${enc(k.branch)}&workflow=${enc(k.workflow)}&artifact=${enc(k.artifact)}`
    : `https://nightly.link/${k.repo}/workflows/${k.workflow}/${k.branch}/${k.artifact}.zip`,
  builds: `https://github.com/${k.repo}/actions/workflows/${k.workflow}?query=branch%3A${enc(k.branch)}`,
  config: `https://github.com/${k.repo}/tree/${enc(k.branch)}`,
});

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "keyboard";

// ---------- shared list ----------

let catalogCache: Board[] | null = null;

export function useCatalog(): [Board[] | null, (b: Board[]) => void] {
  const [list, setList] = useState<Board[] | null>(catalogCache);
  useEffect(() => {
    if (catalogCache) return;
    fetch("/catalog.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => (catalogCache = Array.isArray(j) ? j : []))
      .catch(() => (catalogCache = []))
      .then(() => setList(catalogCache));
  }, []);
  return [list, (b) => setList((catalogCache = b))];
}

/** Owner only: save the shared list (the site rebuilds in about two minutes). */
export const saveCatalog = (list: Board[]) =>
  commitFiles(SITE.repo, SITE.branch, [{ path: SITE.catalog, content: JSON.stringify(list, null, 2) + "\n" }], "Shared keyboards: update\n\nSaved from keys.ryong.com");

// ---------- my keyboards ----------

type Mine = { boards: Board[]; loading: boolean; error: string | null };
let mineCache: (Mine & { key: string }) | null = null;
const mineListeners = new Set<(m: Mine) => void>();

async function loadMine(me: Me): Promise<Board[]> {
  const out: Board[] = [];
  for (const r of me.repos) {
    const text = await readFile(r.full_name, r.default_branch, MY_FILE).catch(() => null);
    if (!text) continue;
    try {
      const j = JSON.parse(text) as { keyboards?: Board[] };
      for (const b of j.keyboards || []) {
        if (b.onlyIn && b.onlyIn !== r.full_name) continue; // inherited from the repository this was copied from
        out.push({ ...b, repo: r.full_name, private: r.private });
      }
    } catch {
      /* unreadable file: skip */
    }
  }
  return out;
}

export function useMyBoards(me: Me) {
  const key = me.user ? `${me.user.login}|${me.repos.map((r) => r.full_name).join(",")}` : "";
  const [state, setState] = useState<Mine>(mineCache && mineCache.key === key ? mineCache : { boards: [], loading: !!key, error: null });

  useEffect(() => {
    const on = (m: Mine) => setState(m);
    mineListeners.add(on);
    return () => {
      mineListeners.delete(on);
    };
  }, []);

  useEffect(() => {
    if (!key) {
      setState({ boards: [], loading: false, error: null });
      return;
    }
    if (mineCache?.key === key) return;
    const publish = (m: Mine) => {
      mineCache = { ...m, key };
      mineListeners.forEach((l) => l(m));
    };
    publish({ boards: [], loading: true, error: null });
    loadMine(me)
      .then((boards) => publish({ boards, loading: false, error: null }))
      .catch((e) => publish({ boards: [], loading: false, error: (e as Error).message }));
  }, [key]);

  /** Replace the list kept in one repository. [skip ci]: editing the list doesn't rebuild firmware. */
  const saveRepo = async (repo: string, boards: Board[]) => {
    const r = me.repos.find((x) => x.full_name === repo);
    if (!r) throw new Error("The site has no access to that repository.");
    const clean = boards.map(({ private: _p, repo: _r, ...b }) => ({ ...b, onlyIn: repo }));
    await commitFiles(repo, r.default_branch, [{ path: MY_FILE, content: JSON.stringify({ version: 1, keyboards: clean }, null, 2) + "\n" }], "keys.ryong.com: update my keyboards [skip ci]");
    const others = state.boards.filter((b) => b.repo !== repo);
    const next = { boards: [...others, ...boards.map((b) => ({ ...b, repo, private: r.private }))], loading: false, error: null };
    mineCache = { ...next, key };
    mineListeners.forEach((l) => l(next));
  };

  return { ...state, saveRepo };
}

// ---------- the keyboard's own name (what Bluetooth and Studio show) ----------
// It lives in the firmware: CONFIG_ZMK_KEYBOARD_NAME in config/<board>.conf, which overrides the
// board's default. Changing it means a new build and a firmware update.

export const NAME_MAX = 16;
export const cleanKeyboardName = (s: string) => s.replace(/["\\]/g, "").trim().slice(0, NAME_MAX);
export const confPath = (b: Board) => `config/${(b.keymap.split("/").pop() || "keyboard").replace(/\.keymap$/, "")}.conf`;
const NAME_LINE = /^[ \t]*CONFIG_ZMK_KEYBOARD_NAME[ \t]*=.*$/m;

export async function readKeyboardName(b: Board): Promise<string | null> {
  const t = await readFile(b.repo, b.branch, confPath(b));
  const m = t?.match(/^[ \t]*CONFIG_ZMK_KEYBOARD_NAME[ \t]*=[ \t]*"([^"]*)"/m);
  return m ? m[1] : null;
}

export async function writeKeyboardName(b: Board, name: string) {
  const path = confPath(b);
  const text = (await readFile(b.repo, b.branch, path)) ?? "";
  const line = `CONFIG_ZMK_KEYBOARD_NAME="${cleanKeyboardName(name)}"`;
  const next = NAME_LINE.test(text) ? text.replace(NAME_LINE, line) : `${text.trimEnd() ? text.trimEnd() + "\n\n" : ""}# Keyboard name shown in Bluetooth and the editor (set on keys.ryong.com)\n${line}\n`;
  await commitFiles(b.repo, b.branch, [{ path, content: next }], `Keyboard name: ${cleanKeyboardName(name)}\n\nSaved from keys.ryong.com`);
}

// ---------- other firmware settings in the same .conf ----------

export async function readConf(b: Board, name: string): Promise<string | null> {
  const t = await readFile(b.repo, b.branch, confPath(b));
  const m = t?.match(new RegExp(`^[ \\t]*${name}[ \\t]*=[ \\t]*(.*)$`, "m"));
  return m ? m[1].trim() : null;
}

/** Set (or with null, remove) one CONFIG_… line; commits, which starts a firmware build. */
export async function writeConf(b: Board, name: string, value: string | null, comment: string, message: string) {
  const path = confPath(b);
  const text = (await readFile(b.repo, b.branch, path)) ?? "";
  const re = new RegExp(`^(?:#[^\\n]*\\n)?[ \\t]*${name}[ \\t]*=.*\\n?`, "m");
  const re1 = new RegExp(`^[ \\t]*${name}[ \\t]*=.*$`, "m");
  let next: string;
  if (value === null) next = text.replace(re, "");
  else if (re1.test(text)) next = text.replace(re1, `${name}=${value}`);
  else next = `${text.trimEnd() ? text.trimEnd() + "\n\n" : ""}# ${comment}\n${name}=${value}\n`;
  await commitFiles(b.repo, b.branch, [{ path, content: next }], `${message}\n\nSaved from keys.ryong.com`);
}
