/**
 * Virtual keyboard for designing and trying the whole experience without hardware.
 *
 * It speaks the real ZMK Studio framing + protobuf, so every screen runs its normal
 * code path (keymap, combos, macros, Tap Dance, Hold-Tap, Bluetooth devices, OS layout,
 * firmware identity). It is a simulation: nothing here proves firmware behaviour.
 * Saved state lives in this browser only (localStorage), never on a device.
 */
import { Request, Response } from "@zmkfirmware/zmk-studio-ts-client/index";
import type { RpcTransport } from "@zmkfirmware/zmk-studio-ts-client/transport/index";
import { get_decoder, get_encoder } from "@zmkfirmware/zmk-studio-ts-client/framing";
import * as C from "../runtime/proto/runtime_combo";
import * as M from "../runtime/proto/runtime_macro";
import * as T from "../runtime/proto/runtime_tapdance";
import * as H from "../runtime/proto/holdtap";
import * as O from "../runtime/proto/os_detection";
import * as B from "../runtime/proto/ble_profiles";
import * as U from "../runtime/proto/update";
import * as S from "../runtime/proto/settings";
import values from "../runtime/keycode-values.json";
import { LAYOUTS } from "../behaviors/layouts";

const codes = values as Record<string, number>;
const STORAGE = "ryong.virtualKeyboard.v2"; // v2: firmware combo/macros as runtime defaults
export const VIRTUAL_NAME = "Ryong60 (virtual)";

type Binding = { behaviorId: number; param1: number; param2: number };
type Layer = { id: number; name: string; bindings: Binding[] };
type Slot = { bonded: boolean; connected: boolean; name: string; host: string; detected: O.Os; override: O.Os; gen: number };
type Macro = { slot: number; name: string; steps: M.MacroStep[] };
type Dance = { index: number; name: string; config: T.Config };
type Hold = { slot: number; behaviorId: number; tappingTermMs: number; quickTapMs: number; requirePriorIdleMs: number; flavor: number };
type Saved = { layers: Layer[]; combos: C.Combo[]; comboTimeout: number; macros: Macro[]; tapMs: number; dances: Dance[]; interval: number; holds: Hold[] };
type Device = { settings: S.Settings; blOn: boolean; ugOn: boolean; blWanted: boolean; ugWanted: boolean };
type State = Saved & { slots: Slot[]; active: number; usb: boolean; nextLayerId: number; nextDance: number; device?: Device };
/* Mirrors modules/ryong-runtime-settings defaults (lights built in but not in use). */
const deviceFactory = (): Device => ({
  settings: S.Settings.fromPartial({ sleepEnabled: true, sleepMinutes: 15,
    backlight: { use: false, onAtStart: true, brightness: 40, usbOnly: false },
    underglow: { use: false, onAtStart: true, brightness: 50, usbOnly: true } }),
  blOn: false, ugOn: false, blWanted: false, ugWanted: false,
});

/* ---- Behaviors: ids and metadata as a Ryong firmware would report them ---- */
const HID = { keyboardMax: 0xff, consumerMax: 0xfff };
const P = (name: string, extra: object) => ({ name, ...extra });
const BEHAVIORS: { id: number; name: string; metadata: object[] }[] = [
  { id: 1, name: "Key Press", metadata: [{ param1: [P("Key", { hidUsage: HID })], param2: [] }] },
  { id: 2, name: "Transparent", metadata: [] },
  { id: 3, name: "None", metadata: [] },
  { id: 4, name: "Momentary Layer", metadata: [{ param1: [P("Layer", { layerId: {} })], param2: [] }] },
  { id: 5, name: "Toggle Layer", metadata: [{ param1: [P("Layer", { layerId: {} })], param2: [] }] },
  { id: 6, name: "To Layer", metadata: [{ param1: [P("Layer", { layerId: {} })], param2: [] }] },
  { id: 7, name: "Sticky Layer", metadata: [{ param1: [P("Layer", { layerId: {} })], param2: [] }] },
  { id: 8, name: "Sticky Key", metadata: [{ param1: [P("Key", { hidUsage: HID })], param2: [] }] },
  { id: 9, name: "Mod-Tap", metadata: [{ param1: [P("Hold", { hidUsage: HID })], param2: [P("Tap", { hidUsage: HID })] }] },
  { id: 10, name: "Layer-Tap", metadata: [{ param1: [P("Hold", { layerId: {} })], param2: [P("Tap", { hidUsage: HID })] }] },
  { id: 11, name: "Bluetooth", metadata: [
    { param1: [P("Next Profile", { constant: 1 }), P("Previous Profile", { constant: 2 }), P("Clear Selected Profile", { constant: 0 }),
      P("Clear All Profiles", { constant: 4 })], param2: [] },
    { param1: [P("Select Profile", { constant: 3 }), P("Disconnect Profile", { constant: 5 })], param2: [P("Profile", { range: { min: 0, max: 4 } })] },
  ] },
  { id: 12, name: "Output Selection", metadata: [{ param1: [P("Toggle", { constant: 0 }), P("USB", { constant: 1 }), P("BLE", { constant: 2 })], param2: [] }] },
  { id: 13, name: "Caps Word", metadata: [] },
  { id: 14, name: "Key Repeat", metadata: [] },
  { id: 15, name: "Bootloader", metadata: [] },
  { id: 16, name: "Reset", metadata: [] },
  { id: 17, name: "Studio Unlock", metadata: [] },
  { id: 18, name: "Soft Off", metadata: [] },
  { id: 19, name: "Grave Escape", metadata: [] },
  { id: 20, name: "Runtime Macro", metadata: [{ param1: [P("Macro", { range: { min: 0, max: 7 } })], param2: [] }] },
  { id: 21, name: "Runtime Tap Dance", metadata: [{ param1: [P("Tap Dance", { range: { min: 0, max: 7 } })], param2: [] }] },
  { id: 22, name: "OS Adaptive Key", metadata: [{ param1: [P("Windows", { hidUsage: HID })], param2: [P("Apple", { hidUsage: HID })] }] },
  // Firmware-built macros turned into runtime defaults: keys call them by name (modules/ryong-named-macro).
  { id: 23, name: "BT_PROFILE0", metadata: [] },
  { id: 24, name: "BT_PROFILE1", metadata: [] },
  { id: 25, name: "BT_PROFILE2", metadata: [] },
  { id: 26, name: "BT_PROFILE3", metadata: [] },
  { id: 27, name: "BLE Update", metadata: [] },
];
/* Runtime defaults seeded from the firmware's own combos/macros (scripts/runtime_defaults.py). */
const btProfileMacros = (): Macro[] => [0, 1, 2, 3].map((n) => ({ slot: n, name: `BT_PROFILE${n}`,
  steps: [M.MacroStep.fromPartial({ tap: { behaviorId: 11, param1: 3, param2: n } }),
    ...[0, 1, 2, 3].filter((x) => x !== n).map((x) => M.MacroStep.fromPartial({ tap: { behaviorId: 11, param1: 5, param2: x } }))] }));

/* ---- Default keymap (BT60 / Ryong60 61-key ANSI, from the imported keymap) ---- */
const HEX: Record<string, number> = { LBKT: 0x7002f, RBKT: 0x70030, C_BRI_DEC: 0xc0070, C_BRI_INC: 0xc006f, C_AC_DESKTOP_SHOW_ALL_WINDOWS: 0xc029f };
const key = (name: string) => codes[name] ?? HEX[name] ?? 0;
function parse(row: string): Binding[] {
  const out: Binding[] = [];
  const tokens = row.trim().split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i], next = () => tokens[++i];
    const b = (behaviorId: number, param1 = 0, param2 = 0) => out.push({ behaviorId, param1, param2 });
    switch (tok) {
      case "&kp": { const k = next(); b(1, k === "TILDE" ? (key("GRAVE") | codes.__mod_LS) >>> 0 : key(k)); break; }
      case "&trans": b(2); break;
      case "&mo": b(4, Number(next())); break;
      case "&tog": b(5, Number(next())); break;
      case "&bt": b(11, codes["__bt_" + next()]); break;
      case "&out": b(12, codes["__out_" + next()]); break;
      case "&bootloader": b(15); break;
      case "&studio_unlock": b(17); break;
      case "&soft_off": b(18); break;
      case "&gresc": b(19); break;
      case "&ry_host": b(22, key(next()), key(next())); break;
      default: {
        const m = /^&BT_Profile(\d)$/.exec(tok);
        if (m) b(23 + Number(m[1])); else throw new Error("virtual keymap token " + tok);
      }
    }
  }
  return out;
}
const T5 = (n: number) => Array(n).fill("&trans").join(" ");
const DEFAULT_LAYERS: [string, string][] = [
  ["base", `&gresc &kp N1 &kp N2 &kp N3 &kp N4 &kp N5 &kp N6 &kp N7 &kp N8 &kp N9 &kp N0 &kp MINUS &kp EQUAL &kp BSPC
    &kp TAB &kp Q &kp W &kp E &kp R &kp T &kp Y &kp U &kp I &kp O &kp P &kp LBKT &kp RBKT &kp BSLH
    &kp CAPS &kp A &kp S &kp D &kp F &kp G &kp H &kp J &kp K &kp L &kp SEMI &kp SQT &kp RET
    &kp LSHFT &kp Z &kp X &kp C &kp V &kp B &kp N &kp M &kp COMMA &kp DOT &kp FSLH &kp RSHFT
    &kp LCTRL &ry_host LGUI LALT &ry_host LALT LGUI &kp SPACE &ry_host RALT RGUI &ry_host C_MENU RALT &kp RCTRL &mo 2`],
  ["os", `${T5(41)} ${T5(12)} &trans &kp LALT &kp LGUI &trans &kp RGUI &kp RALT &trans &trans`],
  ["raise", `&kp GRAVE &kp F1 &kp F2 &kp F3 &kp F4 &kp F5 &kp F6 &kp F7 &kp F8 &kp F9 &kp F10 &kp F11 &kp F12 &kp DEL
    &tog 1 &BT_Profile0 &BT_Profile1 &BT_Profile2 &BT_Profile3 &out OUT_TOG &trans &trans &kp INS &trans &kp PSCRN &trans &trans &studio_unlock
    &kp CAPS ${T5(11)} &bootloader
    ${T5(10)} &kp UP &mo 3
    &soft_off &trans &trans &trans &kp LEFT &kp DOWN &kp RIGHT &trans`],
  ["media", `&kp TILDE &kp C_BRI_DEC &kp C_BRI_INC &kp C_AC_DESKTOP_SHOW_ALL_WINDOWS &kp C_AC_SEARCH &trans &trans &kp C_PREV &kp C_PLAY_PAUSE &kp C_NEXT &kp C_MUTE &kp C_VOL_DN &kp C_VOL_UP &trans
    ${T5(14)}
    &trans &bt BT_CLR_ALL &trans &bt BT_CLR ${T5(9)}
    ${T5(10)} &kp PG_UP &trans
    &trans &trans &trans &trans &kp HOME &kp PG_DN &kp END &trans`],
];
const KEYS = LAYOUTS["60-ansi"];

function factory(): State {
  const layers = DEFAULT_LAYERS.map(([name, row], id) => ({ id, name, bindings: parse(row) }));
  for (const l of layers) if (l.bindings.length !== KEYS.length) throw new Error(`virtual layer ${l.name}: ${l.bindings.length}`);
  const slot = (bonded: boolean, connected: boolean, name: string, host: string, detected: O.Os, gen: number): Slot =>
    ({ bonded, connected, name, host, detected, override: O.Os.OS_UNKNOWN, gen });
  return {
    layers, nextLayerId: layers.length,
    combos: [C.Combo.fromPartial({ index: 0, name: "Studio Unlock (Esc + Backspace)", keyPositions: [0, 13], behavior: { behaviorId: 17 }, layerMask: 0, enabled: true, timeoutMs: 80, source: C.ComboSource.COMBO_SOURCE_DEFAULT })],
    comboTimeout: 50,
    macros: btProfileMacros(),
    tapMs: 30,
    dances: [{ index: 0, name: "Q/Esc", config: T.Config.fromPartial({ singleBinding: { behaviorId: 1, param1: key("Q") }, doubleBinding: { behaviorId: 1, param1: key("ESC") } }) }],
    nextDance: 1, interval: 200,
    holds: [{ slot: 0, behaviorId: 9, tappingTermMs: 200, quickTapMs: -1, requirePriorIdleMs: -1, flavor: 0 },
            { slot: 1, behaviorId: 10, tappingTermMs: 200, quickTapMs: -1, requirePriorIdleMs: -1, flavor: 2 }],
    slots: [slot(true, true, "맥북", "mac", O.Os.OS_MACOS, 1), slot(true, false, "회사 PC", "pc", O.Os.OS_WINDOWS, 1),
            slot(false, false, "", "", O.Os.OS_UNKNOWN, 0), slot(true, false, "", "iphone", O.Os.OS_IOS, 1), slot(false, false, "", "", O.Os.OS_UNKNOWN, 0)],
    active: 0, usb: true,
  };
}

/* ---- Persistence (browser only). Uint8Array is stored as plain arrays. ---- */
const replacer = (_: string, v: unknown) => v instanceof Uint8Array ? { __u8: Array.from(v) } : v;
const reviver = (_: string, v: unknown) => v && typeof v === "object" && "__u8" in (v as object) ? new Uint8Array((v as { __u8: number[] }).__u8) : v;
const clone = <X>(x: X): X => JSON.parse(JSON.stringify(x, replacer), reviver);
function load(): State {
  try { const raw = localStorage.getItem(STORAGE); if (raw) return JSON.parse(raw, reviver); } catch { /* private window etc. */ }
  return factory();
}

type Listener = () => void;
class VirtualDevice {
  flash: State = load();
  ram: Saved = this.saved(this.flash);
  locked = true;
  connected = false;
  private notify?: (msg: Response) => void;
  private listeners = new Set<Listener>();
  private saved(s: State): Saved {
    const { layers, combos, comboTimeout, macros, tapMs, dances, interval, holds } = s;
    return clone({ layers, combos, comboTimeout, macros, tapMs, dances, interval, holds });
  }
  private persist() { try { localStorage.setItem(STORAGE, JSON.stringify(this.flash, replacer)); } catch { /* ignore */ } this.emit(); }
  private emit() { for (const l of this.listeners) l(); }
  subscribe(l: Listener) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }

  /* -- Panel actions (what a person would do with the physical keyboard) -- */
  attach(send: (msg: Response) => void) { this.notify = send; this.connected = true; this.locked = true; this.emit(); }
  detach() { this.notify = undefined; this.connected = false; this.emit(); }
  setLock(locked: boolean) {
    this.locked = locked;
    this.notify?.(Response.fromPartial({ notification: { core: { lockStateChanged: locked ? 0 : 1 } } }));
    this.emit();
  }
  pairActive(host: string, os: O.Os) {
    const s = this.flash.slots[this.flash.active];
    if (s.bonded) return false;
    Object.assign(s, { bonded: true, connected: true, name: "", host, detected: os, override: O.Os.OS_UNKNOWN, gen: s.gen + 1 });
    this.persist(); return true;
  }
  /** Like ZMK: only the selected profile holds a connection; `connected` on a slot means "host in range". */
  linked(i: number) { const s = this.flash.slots[i]; return i === this.flash.active && s.bonded && s.connected; }
  /** USB cable in/out (lights with "only on USB power" follow it, like the firmware's 1 s rule). */
  setUsb(on: boolean) { this.flash.usb = on; this.lightRules(); this.persist(); }
  get device(): Device { return (this.flash.device ??= deviceFactory()); }
  private lightRules() {
    const d = this.device, usb = this.flash.usb;
    for (const [k, on, wanted] of [["backlight", "blOn", "blWanted"], ["underglow", "ugOn", "ugWanted"]] as const) {
      const l = d.settings[k]!, allowed = l.use && (!l.usbOnly || usb);
      if (!allowed && d[on]) { d[wanted] = l.use; d[on] = false; }
      else if (allowed && !d[on] && d[wanted]) d[on] = true;
      if (!l.use) d[wanted] = false;
    }
  }
  toggleLink(i: number) { const s = this.flash.slots[i]; if (s.bonded) { s.connected = !s.connected; this.persist(); } }
  /** Like a power cycle: unsaved keymap/runtime edits are lost, Studio locks again. */
  reboot() {
    this.ram = this.saved(this.flash);
    const d = this.device; // start rules, as settings_runtime.c apply_start()
    for (const [k, on, wanted] of [["backlight", "blOn", "blWanted"], ["underglow", "ugOn", "ugWanted"]] as const) {
      const l = d.settings[k]!; d[wanted] = l.use && l.onAtStart; d[on] = d[wanted] && (!l.usbOnly || this.flash.usb);
    }
    this.persist(); this.setLock(true); this.dirtyNotify();
  }
  factoryReset() { try { localStorage.removeItem(STORAGE); } catch { /* ignore */ } this.flash = factory(); this.ram = this.saved(this.flash); this.persist(); this.setLock(true); }

  private dirty() { return JSON.stringify(this.ram.layers) !== JSON.stringify(this.flash.layers); }
  private dirtyNotify() { this.notify?.(Response.fromPartial({ notification: { keymap: { unsavedChangesStatusChanged: this.dirty() } } })); }

  handle(req: Request): Response {
    const rr = (body: object) => Response.fromPartial({ requestResponse: { requestId: req.requestId, ...body } });
    if (req.core) {
      const c = req.core;
      if (c.getDeviceInfo) return rr({ core: { getDeviceInfo: { name: VIRTUAL_NAME, serialNumber: new Uint8Array([0x52, 0x59, 0x36, 0x30]) } } });
      if (c.getLockState !== undefined) return rr({ core: { getLockState: this.locked ? 0 : 1 } });
      if (c.lock) { this.setLock(true); return rr({ core: {} }); }
      if (c.resetSettings) { if (this.locked) return rr({ meta: { simpleError: 1 } }); this.factoryReset(); return rr({ core: { resetSettings: true } }); }
    }
    if (req.behaviors) {
      if (req.behaviors.listAllBehaviors) return rr({ behaviors: { listAllBehaviors: { behaviors: BEHAVIORS.map(b => b.id) } } });
      const d = BEHAVIORS.find(b => b.id === req.behaviors!.getBehaviorDetails?.behaviorId);
      if (d) return rr({ behaviors: { getBehaviorDetails: { id: d.id, displayName: d.name, metadata: d.metadata } } });
      return rr({ meta: { simpleError: 2 } });
    }
    if (req.keymap) { if (this.locked) return rr({ meta: { simpleError: 1 } }); return rr({ keymap: this.keymap(req.keymap) }); }
    if (req.custom) {
      if (req.custom.listCustomSubsystems) return rr({ custom: { listCustomSubsystems: { subsystems: SUBSYSTEMS.map((identifier, index) => ({ index, identifier, uiUrl: [] })) } } });
      const call = req.custom.call;
      if (call) {
        const id = SUBSYSTEMS[call.subsystemIndex];
        if (!id) return rr({ meta: { simpleError: 2 } });
        if (this.locked && id !== "ryong__firmware_identity") return rr({ meta: { simpleError: 1 } });
        const payload = this.custom(id, call.payload);
        return rr({ custom: { call: { subsystemIndex: call.subsystemIndex, payload } } });
      }
    }
    return rr({ meta: { simpleError: 2 } });
  }

  private keymapMsg() { return { layers: clone(this.ram.layers), availableLayers: 8 - this.ram.layers.length, maxLayerNameLength: 20 }; }
  private keymap(k: NonNullable<Request["keymap"]>) {
    const r = this.ram;
    if (k.getKeymap) return { getKeymap: this.keymapMsg() };
    if (k.getPhysicalLayouts) return { getPhysicalLayouts: { activeLayoutIndex: 0, layouts: [{ name: "60% ANSI", keys: KEYS.map(([x, y, w, h]) => ({ x, y, width: w, height: h, r: 0, rx: 0, ry: 0 })) }] } };
    if (k.setActivePhysicalLayout !== undefined) return { setActivePhysicalLayout: { ok: this.keymapMsg() } };
    if (k.checkUnsavedChanges) return { checkUnsavedChanges: this.dirty() };
    if (k.setLayerBinding) {
      const { layerId, keyPosition, binding } = k.setLayerBinding;
      const layer = r.layers.find(l => l.id === layerId);
      if (!layer || keyPosition >= KEYS.length) return { setLayerBinding: 1 };
      if (!binding || !BEHAVIORS.some(b => b.id === binding.behaviorId)) return { setLayerBinding: 2 };
      layer.bindings[keyPosition] = { behaviorId: binding.behaviorId, param1: binding.param1 >>> 0, param2: binding.param2 >>> 0 };
      queueMicrotask(() => this.dirtyNotify());
      return { setLayerBinding: 0 };
    }
    if (k.saveChanges) { this.flash.layers = clone(r.layers); this.flash.nextLayerId = Math.max(this.flash.nextLayerId, ...r.layers.map(l => l.id + 1)); this.persist(); queueMicrotask(() => this.dirtyNotify()); return { saveChanges: { ok: true } }; }
    if (k.discardChanges) { r.layers = clone(this.flash.layers); queueMicrotask(() => this.dirtyNotify()); return { discardChanges: true }; }
    if (k.moveLayer) {
      const { startIndex, destIndex } = k.moveLayer;
      if (startIndex >= r.layers.length || destIndex >= r.layers.length) return { moveLayer: { err: 2 } };
      const [l] = r.layers.splice(startIndex, 1); r.layers.splice(destIndex, 0, l); queueMicrotask(() => this.dirtyNotify());
      return { moveLayer: { ok: this.keymapMsg() } };
    }
    if (k.addLayer) {
      if (r.layers.length >= 8) return { addLayer: { err: 2 } };
      const layer = { id: Math.max(this.flash.nextLayerId, ...r.layers.map(l => l.id + 1)), name: "", bindings: KEYS.map(() => ({ behaviorId: 2, param1: 0, param2: 0 })) };
      r.layers.push(layer); queueMicrotask(() => this.dirtyNotify());
      return { addLayer: { ok: { index: r.layers.length - 1, layer: clone(layer) } } };
    }
    if (k.removeLayer) {
      if (k.removeLayer.layerIndex >= r.layers.length || r.layers.length <= 1) return { removeLayer: { err: 2 } };
      this.removed.push(r.layers.splice(k.removeLayer.layerIndex, 1)[0]); queueMicrotask(() => this.dirtyNotify());
      return { removeLayer: { ok: {} } };
    }
    if (k.restoreLayer) {
      const i = this.removed.findIndex(l => l.id === k.restoreLayer!.layerId);
      if (i < 0) return { restoreLayer: { err: 2 } };
      const [l] = this.removed.splice(i, 1); r.layers.splice(Math.min(k.restoreLayer.atIndex, r.layers.length), 0, l); queueMicrotask(() => this.dirtyNotify());
      return { restoreLayer: { ok: clone(l) } };
    }
    if (k.setLayerProps) {
      const l = r.layers.find(x => x.id === k.setLayerProps!.layerId);
      if (!l) return { setLayerProps: 2 };
      l.name = k.setLayerProps.name.slice(0, 20); queueMicrotask(() => this.dirtyNotify());
      return { setLayerProps: 0 };
    }
    return {};
  }
  private removed: Layer[] = [];

  private custom(id: string, payload: Uint8Array): Uint8Array {
    switch (id) {
      case "cormoran__runtime_combo": return C.Response.encode(this.combo(C.Request.decode(payload))).finish();
      case "cormoran__runtime_macro": return M.Response.encode(this.macro(M.Request.decode(payload))).finish();
      case "cormoran__runtime_tapdance": return T.Response.encode(this.dance(T.Request.decode(payload))).finish();
      case "zmk__holdtap": return H.Response.encode(this.hold(H.Request.decode(payload))).finish();
      case "cormoran__os_detection": return O.Response.encode(this.os(O.Request.decode(payload))).finish();
      case "ryong__ble_profiles": return B.Response.encode(this.ble(B.Request.decode(payload))).finish();
      case "ryong__settings": return S.Response.encode(this.settings(S.Request.decode(payload))).finish();
      case "ryong__firmware_identity": case "ryong__firmware_update": return U.Response.encode(this.update(id, U.Request.decode(payload))).finish();
    }
    return new Uint8Array();
  }

  /* -- Combos -- */
  private combo(q: C.Request): C.Response {
    const r = this.ram, ok = (n = 1) => C.Response.fromPartial({ status: { affectedCount: n, message: "ok" } });
    const commit = (persist: boolean) => { if (persist) { this.flash.combos = clone(r.combos); this.flash.comboTimeout = r.comboTimeout; this.persist(); } };
    if (q.listCombos) return C.Response.fromPartial({ listCombos: { combos: clone(r.combos) } });
    if (q.getCombo) { const c = r.combos.find(x => x.index === q.getCombo!.index); return c ? C.Response.fromPartial({ getCombo: { combo: c } }) : C.Response.fromPartial({ error: { message: "no combo" } }); }
    if (q.getGlobalSettings) return C.Response.fromPartial({ getGlobalSettings: { settings: { maxCombo: 8, timeoutMs: r.comboTimeout, slowRelease: false, requirePriorIdleMs: 0 } } });
    if (q.setCombo) {
      const s = q.setCombo as unknown as Record<string, unknown> & { index: number; keyPositions: number[]; persist?: boolean };
      if (s.index >= 8 || s.keyPositions.length < 2 || s.keyPositions.length > 4) return C.Response.fromPartial({ error: { message: "combo bounds" } });
      const old = r.combos.find(x => x.index === s.index);
      const next = C.Combo.fromPartial({ ...(old ?? {}), ...(s as object), name: old?.name ?? "", enabled: true, source: C.ComboSource.COMBO_SOURCE_RUNTIME });
      r.combos = r.combos.filter(x => x.index !== s.index).concat([next]).sort((a, b) => a.index - b.index);
      commit(!!s.persist); return ok();
    }
    if (q.setComboName) { const c = r.combos.find(x => x.index === q.setComboName!.index); if (!c) return C.Response.fromPartial({ error: { message: "no combo" } }); c.name = q.setComboName.name; commit(!!(q.setComboName as { persist?: boolean }).persist); return ok(); }
    if (q.deleteCombo) { const c = r.combos.find(x => x.index === q.deleteCombo!.index); if (c) c.enabled = false; commit(!!(q.deleteCombo as { persist?: boolean }).persist); return ok(c ? 1 : 0); }
    if (q.resetCombo) { r.combos = r.combos.filter(x => x.index !== q.resetCombo!.index); return ok(); }
    if (q.setTimeoutMs) { r.comboTimeout = q.setTimeoutMs.timeoutMs; commit(!!q.setTimeoutMs.persist); return ok(); }
    if (q.setSlowRelease || q.setRequirePriorIdleMs) return ok();
    if (q.save) { commit(true); return ok(); }
    if (q.discard) { r.combos = clone(this.flash.combos); r.comboTimeout = this.flash.comboTimeout; return ok(); }
    return C.Response.fromPartial({ error: { message: "unsupported" } });
  }

  /* -- Macros (8 slots, 256 B each, 1024 B shared, names up to 16 B) -- */
  private size(m: Macro) { return m.steps.reduce((n, s) => n + (s.keyTapSequence ? 2 + s.keyTapSequence.packedKeys.length : s.delay ? 4 : 10), 0); }
  private macro(q: M.Request): M.Response {
    const r = this.ram, err = (message: string) => M.Response.fromPartial({ error: { message } }), ok = () => M.Response.fromPartial({ status: { affectedCount: 1, message: "ok" } });
    const persist = (p?: boolean) => { if (p) { this.flash.macros = clone(r.macros); this.flash.tapMs = r.tapMs; this.persist(); } };
    const find = (slot: number) => r.macros.find(m => m.slot === slot);
    const fits = (m: Macro) => this.size(m) <= 256 && r.macros.reduce((n, x) => n + this.size(x === m ? m : x), 0) <= 1024;
    if (q.listMacros) {
      const saved = JSON.stringify(this.flash.macros);
      return M.Response.fromPartial({ listMacros: { macros: r.macros.map(m => ({ slot: m.slot, name: m.name, encodedSize: this.size(m),
        hasUnsavedChanges: JSON.stringify(m) !== JSON.stringify(JSON.parse(saved).find((x: Macro) => x.slot === m.slot) ?? null) })), maxMacroBytes: 256, maxNameLength: 16 } });
    }
    if (q.getMacro) { const m = find(q.getMacro.slot); return m ? M.Response.fromPartial({ getMacro: { macro: { slot: m.slot, name: m.name, steps: clone(m.steps), encodedSize: this.size(m) } } }) : err("no macro"); }
    if (q.getMacroGlobalSettings) return M.Response.fromPartial({ getMacroGlobalSettings: { settings: { tapMs: r.tapMs, maxEntries: 8, keyPressBehaviorId: 1, poolBytesTotal: 1024, poolBytesUsed: r.macros.reduce((n, m) => n + this.size(m), 0) } } });
    if (q.createMacro) {
      const name = q.createMacro.name;
      if (!name || new TextEncoder().encode(name).length > 16 || r.macros.some(m => m.name === name)) return err("bad name");
      const slot = [0, 1, 2, 3, 4, 5, 6, 7].find(i => !find(i));
      if (slot === undefined) return err("no free macro slot");
      r.macros.push({ slot, name, steps: [] }); r.macros.sort((a, b) => a.slot - b.slot); persist(q.createMacro.persist); return ok();
    }
    if (q.setMacroStepCount) { const m = find(q.setMacroStepCount.slot); if (!m || q.setMacroStepCount.stepCount > m.steps.length) return err("bad count"); m.steps.length = q.setMacroStepCount.stepCount; persist(q.setMacroStepCount.persist); return ok(); }
    if (q.appendMacroStep) { const m = find(q.appendMacroStep.slot); if (!m || !q.appendMacroStep.step) return err("no macro"); m.steps.push(q.appendMacroStep.step); if (!fits(m)) { m.steps.pop(); return err("macro too large"); } persist(q.appendMacroStep.persist); return ok(); }
    if (q.setMacroStep) { const m = find(q.setMacroStep.slot); if (!m || !q.setMacroStep.step || q.setMacroStep.stepIndex >= m.steps.length) return err("bad step"); m.steps[q.setMacroStep.stepIndex] = q.setMacroStep.step; persist(q.setMacroStep.persist); return ok(); }
    if (q.renameMacro) { const m = r.macros.find(x => x.name === q.renameMacro!.oldName); if (!m || r.macros.some(x => x.name === q.renameMacro!.newName)) return err("rename"); m.name = q.renameMacro.newName; persist(q.renameMacro.persist); return ok(); }
    if (q.deleteMacro) { r.macros = r.macros.filter(m => m.name !== q.deleteMacro!.name); persist(true); return ok(); }
    if (q.resetMacro) { const m = find(q.resetMacro.slot); if (m) m.steps = []; persist(q.resetMacro.persist); return ok(); }
    if (q.setTapMs) { r.tapMs = q.setTapMs.tapMs; persist(q.setTapMs.persist); return ok(); }
    if (q.saveMacros) { persist(true); return ok(); }
    if (q.discardMacros) { r.macros = clone(this.flash.macros); r.tapMs = this.flash.tapMs; return ok(); }
    return err("unsupported");
  }

  /* -- Tap Dance (api v2, 8 entries, 3 actions, shared interval) -- */
  private dance(q: T.Request): T.Response {
    const r = this.ram, err = (message: string) => T.Response.fromPartial({ error: { code: -22, message } });
    const persist = (p?: boolean) => { if (p) { this.flash.dances = clone(r.dances); this.flash.interval = r.interval; this.flash.nextDance = this.flash.nextDance; this.persist(); } };
    const state = (d: Dance) => T.Response.fromPartial({ state: { index: d.index, name: d.name, config: clone(d.config), intervalMs: r.interval, maxCount: 3,
      hasUnsavedChanges: JSON.stringify(d) !== JSON.stringify(this.flash.dances.find(x => x.index === d.index) ?? null) } });
    const dirty = JSON.stringify(r.dances) !== JSON.stringify(this.flash.dances) || r.interval !== this.flash.interval;
    if (q.getGlobal) return T.Response.fromPartial({ global: { intervalMs: r.interval, maxEntries: 8, usedEntries: r.dances.length, maxNameLength: 16, poolBytesTotal: 512, poolBytesUsed: r.dances.length * 40, hasUnsavedChanges: dirty, apiVersion: 2 } });
    if (q.list) { const after = q.list.hasAfterId ? q.list.afterId : -1; const page = r.dances.filter(d => d.index > after).sort((a, b) => a.index - b.index);
      return T.Response.fromPartial({ list: { entries: page.map(d => ({ index: d.index, name: d.name })), hasMore: false, nextAfterId: 0 } }); }
    if (q.get) { const d = r.dances.find(x => x.index === q.get!.index); return d ? state(d) : err("no tap dance"); }
    if (q.create) {
      if (r.dances.length >= 8 || !q.create.name || r.dances.some(d => d.name === q.create!.name)) return err("cannot create");
      const index = Math.max(this.flash.nextDance, ...r.dances.map(d => d.index + 1)); const d = { index, name: q.create.name, config: T.Config.fromPartial({}) };
      r.dances.push(d); persist(q.create.persist); return state(d);
    }
    if (q.rename) { const d = r.dances.find(x => x.index === q.rename!.index); if (!d) return err("no tap dance"); d.name = q.rename.name; persist(q.rename.persist); return state(d); }
    if (q.set) {
      const d = r.dances.find(x => x.index === q.set!.index); if (!d || q.set.tapCount < 1 || q.set.tapCount > 3) return err("bad tap");
      const key = (["singleBinding", "doubleBinding", "tripleBinding"] as const)[q.set.tapCount - 1];
      d.config = { ...d.config, [key]: q.set.binding?.behaviorId ? clone(q.set.binding) : undefined }; persist(q.set.persist); return state(d);
    }
    if (q.remove) { r.dances = r.dances.filter(d => d.index !== q.remove!.index); persist(q.remove.persist); return T.Response.fromPartial({ status: { affectedCount: 1 } }); }
    if (q.delete) { r.dances = r.dances.filter(d => d.index !== q.delete!.index); persist(true); return T.Response.fromPartial({ status: { affectedCount: 1 } }); }
    if (q.setInterval) { r.interval = q.setInterval.intervalMs; persist(q.setInterval.persist); return T.Response.fromPartial({ status: { affectedCount: 1 } }); }
    if (q.save) { this.flash.nextDance = Math.max(this.flash.nextDance, ...r.dances.map(d => d.index + 1)); persist(true); return T.Response.fromPartial({ status: { affectedCount: 1 } }); }
    if (q.discard) { r.dances = clone(this.flash.dances); r.interval = this.flash.interval; return T.Response.fromPartial({ status: { affectedCount: 1 } }); }
    return err("unsupported");
  }

  /* -- Hold-Tap timing (persists immediately, like the module) -- */
  private hold(q: H.Request): H.Response {
    const r = this.ram;
    if (q.count) return H.Response.fromPartial({ count: { count: r.holds.length } });
    if (q.get) { const h = r.holds.find(x => x.slot === q.get!.slot); return H.Response.fromPartial({ get: h ? { ...h, found: true } : { slot: q.get.slot, found: false } }); }
    if (q.set) { const h = r.holds.find(x => x.slot === q.set!.slot); if (!h) return H.Response.fromPartial({ set: { ok: false, error: 2 } });
      Object.assign(h, { tappingTermMs: q.set.tappingTermMs, quickTapMs: q.set.quickTapMs, requirePriorIdleMs: q.set.requirePriorIdleMs, flavor: q.set.flavor });
      this.flash.holds = clone(r.holds); this.persist(); return H.Response.fromPartial({ set: { ok: true } }); }
    if (q.reset) { const h = r.holds.find(x => x.slot === q.reset!.slot); if (h) Object.assign(h, { tappingTermMs: 200, quickTapMs: -1, requirePriorIdleMs: -1 }); this.flash.holds = clone(r.holds); this.persist(); return H.Response.fromPartial({ reset: { ok: true } }); }
    return H.Response.fromPartial({});
  }

  /* -- OS detection (per slot) -- */
  private profile(i: number): O.BleProfileState {
    const s = this.flash.slots[i];
    const detected = s.bonded ? s.detected : O.Os.OS_UNKNOWN, override = s.bonded ? s.override : O.Os.OS_UNKNOWN;
    return O.BleProfileState.fromPartial({ index: i, bonded: s.bonded, connected: this.linked(i), detected, override, effective: override !== O.Os.OS_UNKNOWN ? override : detected });
  }
  private os(q: O.Request): O.Response {
    if (q.getState) {
      const profiles = this.flash.slots.map((_, i) => this.profile(i));
      return O.Response.fromPartial({ state: { usb: { connected: this.flash.usb, detected: O.Os.OS_MACOS }, bleProfiles: profiles, activeProfileIndex: this.flash.active,
        currentEffective: this.flash.usb ? O.Os.OS_MACOS : profiles[this.flash.active].effective } });
    }
    if (q.setBleOverride) {
      const s = this.flash.slots[q.setBleOverride.profileIndex];
      if (!s?.bonded) return O.Response.fromPartial({ error: { message: "profile not bonded" } });
      s.override = q.setBleOverride.os === O.Os.OS_UNSPECIFIED ? O.Os.OS_UNKNOWN : q.setBleOverride.os; this.persist();
      return O.Response.fromPartial({ setBleOverride: { profile: this.profile(q.setBleOverride.profileIndex) } });
    }
    return O.Response.fromPartial({ error: { message: "unsupported" } });
  }

  /* -- Bluetooth slot manager (mirrors modules/ryong-ble-profiles) -- */
  private token(i: number) { const s = this.flash.slots[i]; return s.bonded ? ((i + 1) * 7919 + s.gen * 104729 + s.host.length) >>> 0 : 0; }
  private ble(q: B.Request): B.Response {
    const f = this.flash, status = (error: number) => B.Response.fromPartial({ status: { ok: false, error } });
    const state = () => B.Response.fromPartial({ state: { activeIndex: f.active, nameMaxBytes: 30, protocolVersion: 1,
      profiles: f.slots.map((s, index) => ({ index, bonded: s.bonded, connected: this.linked(index), name: s.bonded ? s.name : "", token: this.token(index) })) } });
    if (q.getState) return state();
    if (q.select) { if (q.select.index >= f.slots.length) return status(22); f.active = q.select.index; this.persist(); return state(); }
    if (q.rename) {
      const s = f.slots[q.rename.index]; if (!s) return status(22); if (!s.bonded) return status(2); if (q.rename.token !== this.token(q.rename.index)) return status(116);
      if (new TextEncoder().encode(q.rename.name).length > 30 || /^\s|\s$|[\u0000-\u001f\u007f]/.test(q.rename.name)) return status(22);
      s.name = q.rename.name; this.persist(); return state();
    }
    if (q.clear) {
      const s = f.slots[q.clear.index]; if (!s) return status(22); if (!s.bonded) return status(2); if (q.clear.token !== this.token(q.clear.index)) return status(116);
      Object.assign(s, { bonded: false, connected: false, name: "", host: "", detected: O.Os.OS_UNKNOWN, override: O.Os.OS_UNKNOWN, gen: s.gen + 1 }); this.persist(); return state();
    }
    return status(95);
  }

  /* -- Keyboard-side settings (mirrors modules/ryong-runtime-settings) -- */
  private settings(q: S.Request): S.Response {
    const d = this.device, status = (error: number) => S.Response.fromPartial({ status: { ok: false, error } });
    const state = () => S.Response.fromPartial({ state: { settings: d.settings, caps: { backlight: true, underglow: true, sleepMaxMinutes: 1440, bleUpdate: true },
      backlightOn: d.blOn, underglowOn: d.ugOn, usbPowered: this.flash.usb, protocolVersion: 1 } });
    if (q.getState) return state();
    if (q.bleUpdate) return state(); // a real keyboard restarts into the bootloader right after replying
    if (q.set) {
      const n = S.Settings.fromPartial(q.set), ok = (v: number, lo: number, hi: number) => Number.isInteger(v) && v >= lo && v <= hi;
      if (!n.backlight || !n.underglow || !ok(n.sleepMinutes, 1, 1440) || !ok(n.backlight.brightness, 0, 100) || !ok(n.underglow.brightness, 0, 100)) return status(22);
      d.settings = n; this.lightRules(); this.persist(); return state();
    }
    if (q.power) {
      const k = q.power.which === 0 ? "backlight" : q.power.which === 1 ? "underglow" : null;
      if (!k) return status(134);
      const l = d.settings[k]!;
      if (q.power.on && !(l.use && (!l.usbOnly || this.flash.usb))) return status(1);
      if (k === "backlight") { d.blOn = q.power.on; d.blWanted = q.power.on; } else { d.ugOn = q.power.on; d.ugWanted = q.power.on; }
      this.persist(); return state();
    }
    return status(95);
  }

  /* -- Firmware identity: installs stay disabled, exactly like development firmware -- */
  private update(id: string, q: U.Request): U.Response {
    if (q.identity) return U.Response.fromPartial({ identity: { model: "ryong60-virtual", buildId: "virtual-preview", version: 1, bootloaderAllowed: false } });
    void id; return U.Response.fromPartial({ status: { ok: false, error: 1 } });
  }
}

const SUBSYSTEMS = ["cormoran__runtime_combo", "cormoran__runtime_macro", "cormoran__runtime_tapdance", "zmk__holdtap",
  "cormoran__os_detection", "ryong__ble_profiles", "ryong__firmware_identity", "ryong__firmware_update", "ryong__settings"];

let instance: VirtualDevice | undefined;
/** Created on first use so a simulation bug can never break the normal app. */
export function getVirtualDevice() {
  if (!instance) {
    instance = new VirtualDevice();
    // Lets automated end-to-end tests read the simulated flash; development copy only.
    try { (window as unknown as { __ryongVirtual?: VirtualDevice }).__ryongVirtual = instance; } catch { /* no window */ }
  }
  return instance;
}

/** Transport the app treats like USB. Small delays keep progress states visible. */
export async function virtualConnect(): Promise<RpcTransport> {
  const virtualDevice = getVirtualDevice();
  const abortController = new AbortController();
  let out!: ReadableStreamDefaultController<Uint8Array>;
  const responses = new ReadableStream<Uint8Array>({ start(c) { out = c; } });
  const send = (msg: Response) => { try { out.enqueue(Response.encode(msg).finish()); } catch { /* closed */ } };
  const decoder = new TransformStream<Uint8Array, Uint8Array>(get_decoder());
  decoder.readable.pipeTo(new WritableStream<Uint8Array>({
    write(frame) {
      const req = Request.decode(frame);
      return new Promise(resolve => setTimeout(() => { send(virtualDevice.handle(req)); resolve(); }, 3));
    },
  })).catch(() => undefined);
  abortController.signal.addEventListener("abort", () => { virtualDevice.detach(); try { out.close(); } catch { /* ignore */ } });
  virtualDevice.attach(send);
  return { label: "Virtual", abortController, readable: responses.pipeThrough(new TransformStream(get_encoder())), writable: decoder.writable };
}
