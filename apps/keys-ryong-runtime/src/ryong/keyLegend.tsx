// What a key in the editor shows: the main legend (what it types or does) and a small line for how
// (a layer key's "MO", a Mod-Tap's hold modifier). Studio's own keys only show the key code, so a
// Momentary Layer key came out as an empty cap with "MLayr" on it.
import type { Keymap } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import type { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import { hid_usage_get_labels, hid_usage_page_and_id_from_usage } from "../hid-usages";
import { tidyLabels } from "./hidLabels";

export type IconName = "play-pause" | "mute" | "vol-up" | "vol-down" | "bri-up" | "bri-down" | "next" | "prev" | "left" | "right" | "up" | "down";

export interface Legend {
  main: string;
  /** media and arrow keys: one icon set instead of Studio's mix of emoji and symbols (main is its name in words) */
  icon?: IconName;
  sub?: string;
  /** an empty or see-through key: drawn faint */
  quiet?: boolean;
}

// by HID page and id
const ICONS: Record<string, IconName> = {
  "12:205": "play-pause", "12:226": "mute", "12:233": "vol-up", "12:234": "vol-down",
  "12:111": "bri-up", "12:112": "bri-down", "12:181": "next", "12:182": "prev",
  "7:79": "right", "7:80": "left", "7:81": "down", "7:82": "up",
};
export function keyIcon(usage: number): IconName | undefined {
  let [page, id] = hid_usage_page_and_id_from_usage(usage);
  page &= 0xff;
  return ICONS[`${page}:${id}`];
}

const strip = (s?: string) => s?.replace(/^Keyboard /, "") ?? "";

/** A key code's label, longer on wider keys ("Shift" on a Shift key, "Shft" on a 1u key). */
export function keyName(usage: number, wide: boolean): string {
  let [page, id] = hid_usage_page_and_id_from_usage(usage);
  page &= 0xff;
  const l = tidyLabels(hid_usage_get_labels(page, id));
  const nice: Record<string, string> = { Ret: "Enter", Return: "Enter", Cap: "Caps", Shft: "Shift", "L Shft": "Shift", "R Shft": "Shift", BkSp: "Bksp", BkSpc: "Bksp", AltG: "AltGr", Appl: "Menu", "␣": "Spc",
    // Studio names some media keys with emoji, which come out in every colour and size: words instead
    "🔆": "Bri +", "🔅": "Bri −", "⇥": "Next", "⇤": "Prev", "⏯️": "Play", "⏯": "Play", "🔇": "Mute", "🔊": "Vol +", "🔉": "Vol −" };
  const pick = strip(wide ? l.long && l.long.length <= 9 ? l.long : l.med || l.short : l.short);
  const s = nice[pick] ?? pick;
  // left/right is clear from where the key sits
  const t = s.replace(/^(L|Left|R|Right) (?=\S)/, "");
  return nice[t] ?? t;
}

function layerName(keymap: Keymap, value: number): string {
  const byId = keymap.layers.findIndex((l) => l.id === value);
  const i = byId >= 0 ? byId : value;
  const name = keymap.layers[i]?.name?.trim();
  return name ? (name.length > 7 ? name.slice(0, 6) + "…" : name) : `L${i}`;
}

const BT = ["BT Clr", "BT Next", "BT Prev", "BT", "BT Clr All", "BT Disc"];
const OUT = ["Out Tog", "USB", "BLE"];
const MOUSE: Record<number, string> = { 1: "L Click", 2: "R Click", 4: "M Click", 8: "Back", 16: "Fwd" };

export function legendFor(
  binding: { behaviorId: number; param1: number; param2: number } | undefined,
  behaviors: Record<number, GetBehaviorDetailsResponse>,
  keymap: Keymap,
  widthU: number,
): Legend {
  if (!binding) return { main: "", quiet: true };
  const name = behaviors[binding.behaviorId]?.displayName ?? "";
  const wide = widthU >= 1.5;
  const { param1: p1, param2: p2 } = binding;
  switch (name) {
    case "Key Press":
      return { main: keyName(p1, wide), icon: keyIcon(p1) };
    case "Momentary Layer":
      return { main: layerName(keymap, p1), sub: "MO" };
    case "Toggle Layer":
      return { main: layerName(keymap, p1), sub: "TG" };
    case "To Layer":
      return { main: layerName(keymap, p1), sub: "TO" };
    case "Sticky Layer":
      return { main: layerName(keymap, p1), sub: "SL" };
    case "Layer-Tap":
      return { main: keyName(p2, wide), icon: keyIcon(p2), sub: layerName(keymap, p1) }; // tap: the key, hold: the layer (a dual legend)
    case "Mod-Tap":
      return { main: keyName(p2, wide), icon: keyIcon(p2), sub: keyName(p1, false) }; // tap: the key, hold: the modifier
    case "Sticky Key":
      return { main: keyName(p1, wide), sub: "SK" };
    case "Key Toggle":
      return { main: keyName(p1, wide), sub: "KT" };
    case "Transparent":
      return { main: "▽", quiet: true };
    case "None":
      return { main: "", quiet: true };
    case "Bluetooth":
      return { main: p1 === 3 || p1 === 5 ? `${BT[p1]} ${p2}` : BT[p1] ?? "BT" };
    case "Output Selection":
      return { main: OUT[p1] ?? "Out" };
    case "Bootloader":
      return { main: "Boot" };
    case "Reset":
      return { main: "Reset" };
    case "Studio Unlock":
      return { main: "Unlock" };
    case "Soft Off":
      return { main: "Off" };
    case "Caps Word":
      return { main: "Caps Word" };
    case "Key Repeat":
      return { main: "Repeat" };
    case "Grave/Escape":
      return { main: "Esc", sub: "`" };
    case "Mouse Key Press":
      return { main: MOUSE[p1] ?? "Click" };
    case "External Power":
      return { main: ["Pwr Off", "Pwr On", "Pwr Tog"][p1] ?? "Ext Pwr" };
    case "":
      return { main: "?", quiet: true };
    default:
      // combos, macros, tap-dances and anything else: its own name
      return { main: name };
  }
}

/**
 * How much a legend has to shrink to sit on its key: words are never broken, so the longest word sets it
 * (`cap`: letters per line at full size, about 4 across a 1u cap). Up to two lines; anything longer ends in "…".
 */
export function legendFit(text: string, widthU: number, cap = 4.8 * widthU - 0.4): { fit: number; lines: number } {
  const words = text.split(/\s+/).filter(Boolean);
  const longest = Math.max(1, ...words.map((w) => w.length));
  const oneLine = text.length;
  if (oneLine <= cap) return { fit: 1, lines: 1 };
  // one line, a little smaller
  if (oneLine <= cap / 0.66) return { fit: cap / oneLine, lines: 1 };
  // two lines, broken between words
  return { fit: Math.max(0.62, Math.min(0.82, cap / longest)), lines: 2 };
}

/** The same for the 3D view, where the legend sits on the (smaller) top of the cap at 12px. */
export const legendFit3d = (text: string, widthU: number) => legendFit(text, widthU, (48 * widthU - 18) / 6.8);
