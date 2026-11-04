// Put a behavior on one key of the keyboard's keymap from the behavior editors (tap dance, tap·hold),
// so a person picks "which key" right where they set "what it does". Studio's keymap RPC; the change is
// saved on the keyboard at once, and the keymap view is told to read it again.
import type { RpcConnection } from "@zmkfirmware/zmk-studio-ts-client/index";
import { call_rpc } from "../../rpc/pipeline";
import type { RuntimeView } from "./modelBridge";
import { decode } from "./modelBridge";
import type { Binding } from "../behaviors/model";
import { t } from "../i18n";

export type Wire = { behaviorId: number; param1: number; param2: number };

export function wireAt(view: RuntimeView, layer: number, pos: number): Wire | undefined {
  const b = view.snapshot.keymap?.layers[layer]?.bindings[pos];
  return b ? { behaviorId: b.behaviorId, param1: b.param1, param2: b.param2 } : undefined;
}

/** What the key does now, in the editor's terms (undefined if the editor cannot show it). */
export function bindingAt(view: RuntimeView, layer: number, pos: number): Binding | undefined {
  try { return decode(wireAt(view, layer, pos), view); } catch { return undefined; }
}

/** Keys (layer, position) that carry this behavior and first parameter. */
export function keysWith(view: RuntimeView, behaviorId: number, param1: number): { layer: number; pos: number }[] {
  const out: { layer: number; pos: number }[] = [];
  view.snapshot.keymap?.layers.forEach((l, layer) => l.bindings.forEach((b, pos) => {
    if (b.behaviorId === behaviorId && b.param1 === param1) out.push({ layer, pos });
  }));
  return out;
}

export async function assignKey(conn: RpcConnection, view: RuntimeView, layer: number, pos: number, binding: Wire) {
  const layerId = view.snapshot.keymap?.layers[layer]?.id;
  if (layerId === undefined) throw new Error(t("Unknown layer.", "레이어를 찾을 수 없어요."));
  const dirty = (await call_rpc(conn, { keymap: { checkUnsavedChanges: true } })).keymap?.checkUnsavedChanges;
  if (dirty) throw new Error(t("Save or discard the keymap edits first.", "키맵 탭의 저장 안 된 변경을 먼저 저장하거나 취소하세요."));
  const set = (await call_rpc(conn, { keymap: { setLayerBinding: { layerId, keyPosition: pos, binding } } })).keymap?.setLayerBinding;
  if (set !== 0) throw new Error(t("The keyboard did not accept the key.", "키보드가 이 키 설정을 받지 않았어요."));
  const saved = (await call_rpc(conn, { keymap: { saveChanges: true } })).keymap?.saveChanges;
  if (!saved?.ok) throw new Error(t("The keyboard could not save the keymap.", "키보드가 키맵을 저장하지 못했어요."));
  window.dispatchEvent(new Event("ryong:keymap-changed"));
}
