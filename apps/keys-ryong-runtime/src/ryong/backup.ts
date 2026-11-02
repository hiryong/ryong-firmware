// Keymap backup/restore — save the keys changed in the editor to a file, and put them back after a firmware update or reset.
// Behavior ids can change between firmware builds, so bindings are stored by display name and looked up again on restore.

import type { RpcConnection } from "@zmkfirmware/zmk-studio-ts-client";
import { SetLayerBindingResponse } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import type { Keymap } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import { call_rpc } from "../rpc/logging";

export interface BackupBinding {
  behavior: string;
  param1: number;
  param2: number;
  dynamicReference?: {kind: "macro" | "dance"; name: string};
}

export interface KeymapBackup {
  format: "ryong-keymap-backup";
  version: 1;
  createdAt: string;
  device: string;
  layout?: string;
  layers: { name: string; bindings: BackupBinding[] }[];
}

export type BehaviorNames = Record<number, string>;

export async function fetchBehaviorNames(conn: RpcConnection): Promise<BehaviorNames> {
  const list = await call_rpc(conn, { behaviors: { listAllBehaviors: true } });
  const names: BehaviorNames = {};
  for (const behaviorId of list.behaviors?.listAllBehaviors?.behaviors || []) {
    const d = await call_rpc(conn, { behaviors: { getBehaviorDetails: { behaviorId } } });
    const det = d?.behaviors?.getBehaviorDetails;
    if (det) names[det.id] = det.displayName;
  }
  return names;
}

export async function fetchKeymap(conn: RpcConnection): Promise<Keymap | undefined> {
  const r = await call_rpc(conn, { keymap: { getKeymap: true } });
  return r?.keymap?.getKeymap;
}

export async function fetchActiveLayoutName(conn: RpcConnection): Promise<string | undefined> {
  const r = await call_rpc(conn, { keymap: { getPhysicalLayouts: true } });
  const pl = r?.keymap?.getPhysicalLayouts;
  return pl?.layouts?.[pl.activeLayoutIndex]?.name;
}

export async function createBackup(conn: RpcConnection, device: string): Promise<KeymapBackup> {
  const [names, keymap, layout] = [
    await fetchBehaviorNames(conn),
    await fetchKeymap(conn),
    await fetchActiveLayoutName(conn),
  ];
  if (!keymap) throw new Error("Could not read the keymap.");
  return {
    format: "ryong-keymap-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    device,
    layout,
    layers: keymap.layers.map((l) => ({
      name: l.name,
      bindings: l.bindings.map((b) => ({
        behavior: names[b.behaviorId] ?? `#${b.behaviorId}`,
        param1: b.param1,
        param2: b.param2,
      })),
    })),
  };
}

export function parseBackup(text: string): KeymapBackup {
  let data = JSON.parse(text);
  if(data?.format === "ryong-update-backup"){
    if(data.version !== 1)throw new Error("Unsupported update backup version.");
    data=data.keymap;
  }
  if (data?.format !== "ryong-keymap-backup" || !Array.isArray(data.layers)) {
    throw new Error("This is not a keys.ryong.com backup file.");
  }
  return data as KeymapBackup;
}

export function resolveBackupBinding(binding:BackupBinding,byName:Record<string,number>,runtime:import("./runtime/modelBridge").RuntimeView|null){
 const ref=binding.dynamicReference;
 if(ref){
  if(!runtime||typeof ref.name!=="string")return undefined;
  if(ref.kind==="macro"){
   const matches=runtime.snapshot.macros.filter(m=>m.name===ref.name);
   return matches.length===1&&runtime.catalog.ref?{behaviorId:runtime.catalog.ref,param1:matches[0].slot,param2:0}:undefined;
  }
  if(ref.kind==="dance"){
   const matches=(runtime.snapshot.advanced?.dances??[]).filter(d=>d.name===ref.name);
   return matches.length===1&&runtime.catalog.rtd?{behaviorId:runtime.catalog.rtd,param1:matches[0].index,param2:0}:undefined;
  }
  return undefined;
 }
 const behaviorId=byName[binding.behavior];
 return behaviorId===undefined?undefined:{behaviorId,param1:binding.param1,param2:binding.param2};
}

export interface RestoreResult {
  changed: number;
  skipped: string[];
}

/** Applies a backup to the connected keyboard. The user still presses Save to keep it. */
export async function restoreBackup(
  conn: RpcConnection,
  backup: KeymapBackup,
  onProgress?: (done: number, total: number) => void
): Promise<RestoreResult> {
  // Load runtime names before changing layers. Restoring dynamic settings
  // first may have assigned different slots/IDs; never guess them.
  const needsRuntime=backup.layers.some(l=>l.bindings.some(b=>b.dynamicReference));
  const runtime=needsRuntime?await (await import("./runtime/modelBridge")).loadRuntimeView(conn):null;
  const names = await fetchBehaviorNames(conn);
  const byName: Record<string, number> = {};
  for (const [id, n] of Object.entries(names)) byName[n] = Number(id);

  let keymap = await fetchKeymap(conn);
  if (!keymap) throw new Error("Could not read the keymap.");

  const skipped: string[] = [];

  // If the backup has more layers, add as many as the keyboard allows.
  while (keymap.layers.length < backup.layers.length && keymap.availableLayers > 0) {
    const r = await call_rpc(conn, { keymap: { addLayer: {} } });
    if (!r.keymap?.addLayer?.ok) break;
    keymap = (await fetchKeymap(conn)) ?? keymap;
  }
  if (keymap.layers.length < backup.layers.length) {
    skipped.push(`${backup.layers.length - keymap.layers.length} layer(s) (no room on the keyboard)`);
  }

  const total = backup.layers.reduce((n, l) => n + l.bindings.length, 0);
  let done = 0;
  let changed = 0;
  const unknown = new Set<string>();

  for (let li = 0; li < Math.min(keymap.layers.length, backup.layers.length); li++) {
    const target = keymap.layers[li];
    const src = backup.layers[li];

    if (src.name && src.name !== target.name) {
      const name = src.name.slice(0, keymap.maxLayerNameLength || src.name.length);
      await call_rpc(conn, { keymap: { setLayerProps: { layerId: target.id, name } } });
    }

    for (let pos = 0; pos < src.bindings.length; pos++) {
      done++;
      if (pos >= target.bindings.length) continue;
      const b = src.bindings[pos];
      const resolved=resolveBackupBinding(b,byName,runtime);
      const behaviorId=resolved?.behaviorId;
      if (behaviorId === undefined) {
        unknown.add(b.dynamicReference ? `${b.dynamicReference.kind}: ${b.dynamicReference.name}` : b.behavior);
        continue;
      }
      const cur = target.bindings[pos];
      if (cur.behaviorId === behaviorId && cur.param1 === resolved!.param1 && cur.param2 === resolved!.param2) continue;

      const r = await call_rpc(conn, {
        keymap: { setLayerBinding: { layerId: target.id, keyPosition: pos, binding: resolved! } },
      });
      if (r.keymap?.setLayerBinding === SetLayerBindingResponse.SET_LAYER_BINDING_RESP_OK) changed++;
      if (done % 8 === 0) onProgress?.(done, total);
    }
  }
  onProgress?.(total, total);

  if (unknown.size) skipped.push(`behaviors this firmware lacks: ${[...unknown].join(", ")}`);
  return { changed, skipped };
}

// ---------- Snapshots: the keys as last saved, kept in this browser (5 per keyboard) ----------

const SNAP_KEY = "ryong.snapshots";
const SNAP_PER_DEVICE = 5;

export function listSnapshots(): KeymapBackup[] {
  try {
    const v = JSON.parse(localStorage.getItem(SNAP_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export const latestSnapshot = (device: string) => listSnapshots().find((x) => x.device === device) ?? null;

export function saveSnapshot(b: KeymapBackup) {
  try {
    const all = listSnapshots();
    const sig = (x: KeymapBackup) => JSON.stringify(x.layers);
    // Same keys as this keyboard's latest snapshot: just refresh its time
    const prevIdx = all.findIndex((x) => x.device === b.device);
    if (prevIdx >= 0 && sig(all[prevIdx]) === sig(b)) all.splice(prevIdx, 1);
    all.unshift(b);
    const count: Record<string, number> = {};
    const kept = all.filter((x) => (count[x.device] = (count[x.device] || 0) + 1) <= SNAP_PER_DEVICE);
    localStorage.setItem(SNAP_KEY, JSON.stringify(kept));
  } catch {
    /* storage full or unavailable: skip quietly */
  }
}

/** How many keys differ between two keymaps (layers matched by position). */
export function diffCount(a: KeymapBackup, b: KeymapBackup): number {
  let n = 0;
  const layers = Math.max(a.layers.length, b.layers.length);
  for (let l = 0; l < layers; l++) {
    const x = a.layers[l]?.bindings || [];
    const y = b.layers[l]?.bindings || [];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const p = x[i];
      const q = y[i];
      if (!p || !q || p.behavior !== q.behavior || p.param1 !== q.param1 || p.param2 !== q.param2) n++;
    }
  }
  return n;
}

export function downloadBackup(b: KeymapBackup) {
  const stamp = b.createdAt.slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})/, "$1-");
  const safe = b.device.replace(/[^\w.-]+/g, "_") || "keyboard";
  const blob = new Blob([JSON.stringify(b, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${safe}-keymap-${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
