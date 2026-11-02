// The special keys of a keyboard — unlock, bootloader — worked out the same way everywhere on the site:
//
// 1. the connected, unlocked keyboard (includes changes made in the editor)
// 2. otherwise the firmware's files on GitHub: the keymap file, and an unlock combo in ryong-behaviors.json —
//    combos can't be changed in the editor, so that one is right even before unlocking
// 3. what was typed on the keyboard's card (older entries)

import { useContext, useEffect, useState } from "react";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import { ConnectionContext } from "../rpc/ConnectionContext";
import { LockStateContext } from "../rpc/LockStateContext";
import { call_rpc } from "../rpc/logging";
import { useSub } from "../usePubSub";
import { readFile } from "./api";
import type { Board } from "./keyboards";
import { dirOf } from "./behaviors/keymapFile";
import { LAYOUTS } from "./behaviors/layouts";
import { At, baseKeyName, findInKeymap, keysAt, positionsAt } from "./power";

/** A key to draw: its name and where it sits on the board ([x, y, width] in 1/100 key units). */
export interface KeyGeo {
  label: string;
  x: number;
  y: number;
  w: number;
}

export interface BoardKeys {
  /** pressed together, from the firmware's combos */
  unlockCombo?: string[];
  unlockComboKeys?: KeyGeo[];
  /** the unlock key (and the layer key held for it), with positions */
  unlockKeys?: KeyGeo[];
  /** a key (often with Fn) */
  unlock?: string[];
  bootloader?: string[];
  bootloaderKeys?: KeyGeo[];
  /** read from the keyboard itself (not just the firmware's defaults) */
  fromKeyboard?: boolean;
}

// ---------- files (cached briefly: every card asks) ----------

const cache = new Map<string, { at: number; p: Promise<string | null> }>();
export function readCached(repo: string, branch: string, path: string) {
  const k = `${repo}|${branch}|${path}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < 60_000) return hit.p;
  const p = readFile(repo, branch, path).catch(() => null);
  cache.set(k, { at: Date.now(), p });
  return p;
}
export const forgetCached = () => cache.clear();

const split = (s?: string) => (s ? s.split(/\s*\+\s*/).filter(Boolean) : undefined);

function geo(b: Board, positions: number[], labels: string[]): KeyGeo[] | undefined {
  const layout = LAYOUTS[b.layout || "60-ansi"];
  if (!layout || positions.some((p) => !layout[p])) return undefined;
  return positions.map((p, i) => ({ label: labels[i], x: layout[p][0], y: layout[p][1], w: layout[p][2] }));
}

export async function keysFromFiles(b: Board): Promise<BoardKeys & { keymap: string | null }> {
  const [keymap, beh] = await Promise.all([
    readCached(b.repo, b.branch, b.keymap),
    readCached(b.repo, b.branch, `${dirOf(b.keymap)}ryong-behaviors.json`),
  ]);
  const out: BoardKeys & { keymap: string | null } = { keymap };
  try {
    const combo = beh ? JSON.parse(beh).combos?.find((c: { binding?: { b?: string } }) => c.binding?.b === "studio_unlock") : null;
    if (combo?.keys?.length) {
      const layout = LAYOUTS[b.layout || "60-ansi"];
      out.unlockCombo = (combo.keys as number[]).map((p) => (keymap ? baseKeyName(keymap, p) : layout?.[p]?.[4] ?? `#${p + 1}`));
      out.unlockComboKeys = geo(b, combo.keys as number[], out.unlockCombo);
    }
  } catch {
    /* unreadable */
  }
  if (keymap) {
    const at = findInKeymap(keymap, "&studio_unlock");
    out.unlock = keysAt(keymap, at) ?? undefined;
    const pos = positionsAt(keymap, at);
    if (pos && out.unlock) out.unlockKeys = geo(b, pos, out.unlock);
    const bat = findInKeymap(keymap, "&bootloader");
    out.bootloader = keysAt(keymap, bat) ?? undefined;
    const bpos = positionsAt(keymap, bat);
    if (bpos && out.bootloader) out.bootloaderKeys = geo(b, bpos, out.bootloader);
  }
  out.unlock ??= split(b.unlockKey);
  out.bootloader ??= split(b.bootloaderKey);
  return out;
}

// ---------- live, from the connected keyboard ----------

/** Positions of behaviors (by display name) on the connected, unlocked keyboard. */
export function useLiveBehaviors(enabled: boolean, names: Record<string, RegExp>) {
  const { conn } = useContext(ConnectionContext);
  const lock = useContext(LockStateContext);
  const [found, setFound] = useState<Record<string, At[]> | null>(null);
  const [tick, setTick] = useState(0);
  useSub("rpc_notification.keymap.unsavedChangesStatusChanged", () => setTick((n) => n + 1));
  const key = Object.keys(names).join(",");
  useEffect(() => {
    if (!enabled || !conn || lock !== LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED) {
      setFound(null);
      return;
    }
    let ignore = false;
    (async () => {
      const list = (await call_rpc(conn, { behaviors: { listAllBehaviors: true } }))?.behaviors?.listAllBehaviors?.behaviors || [];
      const ids: Record<number, string> = {};
      for (const id of list) {
        const d = (await call_rpc(conn, { behaviors: { getBehaviorDetails: { behaviorId: id } } }))?.behaviors?.getBehaviorDetails;
        if (!d) continue;
        for (const [n, re] of Object.entries(names)) if (re.test(d.displayName)) ids[d.id] = n;
      }
      const km = (await call_rpc(conn, { keymap: { getKeymap: true } }))?.keymap?.getKeymap;
      if (ignore || !km) return;
      const out: Record<string, At[]> = Object.fromEntries(Object.keys(names).map((n) => [n, []]));
      km.layers.forEach((l, li) => l.bindings.forEach((b, p) => ids[b.behaviorId] && out[ids[b.behaviorId]].push({ layer: li, pos: p })));
      setFound(out);
    })().catch(() => !ignore && setFound(null));
    return () => {
      ignore = true;
    };
  }, [enabled, conn, lock, tick, key]);
  return found;
}

export const SPECIAL = { unlock: /studio\s*unlock/i, bootloader: /bootloader/i, softOff: /soft[\s_-]*off/i };

/** Everything for one keyboard; `live` = it is the connected keyboard. */
export function useBoardKeys(b: Board | undefined, live: boolean) {
  const [files, setFiles] = useState<(BoardKeys & { keymap: string | null }) | null>(null);
  const liveAt = useLiveBehaviors(!!b && live, SPECIAL);
  useEffect(() => {
    if (!b) return setFiles(null);
    let ignore = false;
    keysFromFiles(b).then((k) => !ignore && setFiles(k));
    return () => {
      ignore = true;
    };
  }, [b?.repo, b?.branch, b?.keymap]);

  const keymap = files?.keymap ?? null;
  let out: BoardKeys = { ...(files ?? {}) };
  if (liveAt && keymap) {
    out = {
      ...out,
      unlock: keysAt(keymap, liveAt.unlock) ?? out.unlock,
      bootloader: keysAt(keymap, liveAt.bootloader) ?? out.bootloader,
      fromKeyboard: true,
    };
  }
  return { keys: files ? out : null, liveAt, keymap };
}
