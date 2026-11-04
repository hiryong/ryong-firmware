import { ReactNode, useContext, useMemo, useState } from "react";
import type { BehaviorBinding } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import type { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import values from "./keycode-values.json";
import { RuntimeBindingsContext, namedRuntimeBindings, checkedRuntimeBinding } from "./bindings";
import { t } from "../i18n";

/** VIA-style picker: click a tile and the selected key gets it. The Studio dropdowns stay below for full control. */
const codes = values as Record<string, number>;
const HEX: Record<string, number> = { LBKT: 0x7002f, RBKT: 0x70030, C_BRI_DEC: 0xc0070, C_BRI_INC: 0xc006f, NUBS: 0x70064 };
const usage = (k: string) => codes[k] ?? HEX[k];
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

type Tile = { label: string; title?: string; binding: BehaviorBinding; wide?: boolean };
type Tab = { id: string; label: string; tiles: Tile[] };

const BASIC: [string, string][] = [
  ["Esc", "ESC"], ["F1", "F1"], ["F2", "F2"], ["F3", "F3"], ["F4", "F4"], ["F5", "F5"], ["F6", "F6"], ["F7", "F7"], ["F8", "F8"], ["F9", "F9"], ["F10", "F10"], ["F11", "F11"], ["F12", "F12"],
  ["`", "GRAVE"], ["1", "N1"], ["2", "N2"], ["3", "N3"], ["4", "N4"], ["5", "N5"], ["6", "N6"], ["7", "N7"], ["8", "N8"], ["9", "N9"], ["0", "N0"], ["-", "MINUS"], ["=", "EQUAL"], ["Bksp", "BSPC"],
  ["Tab", "TAB"], ["Q", "Q"], ["W", "W"], ["E", "E"], ["R", "R"], ["T", "T"], ["Y", "Y"], ["U", "U"], ["I", "I"], ["O", "O"], ["P", "P"], ["[", "LBKT"], ["]", "RBKT"], ["\\", "BSLH"],
  ["Caps", "CAPS"], ["A", "A"], ["S", "S"], ["D", "D"], ["F", "F"], ["G", "G"], ["H", "H"], ["J", "J"], ["K", "K"], ["L", "L"], [";", "SEMI"], ["'", "SQT"], ["Enter", "RET"],
  ["Z", "Z"], ["X", "X"], ["C", "C"], ["V", "V"], ["B", "B"], ["N", "N"], ["M", "M"], [",", "COMMA"], [".", "DOT"], ["/", "FSLH"], ["Space", "SPACE"],
];
const MODS: [string, string][] = [["L Ctrl", "LCTRL"], ["L Shift", "LSHFT"], ["L Alt · Opt", "LALT"], ["L Win · Cmd", "LGUI"], ["R Ctrl", "RCTRL"], ["R Shift", "RSHFT"], ["R Alt · Opt", "RALT"], ["R Win · Cmd", "RGUI"]];
const NAV: [string, string][] = [["↑", "UP"], ["↓", "DOWN"], ["←", "LEFT"], ["→", "RIGHT"], ["Home", "HOME"], ["End", "END"], ["PgUp", "PG_UP"], ["PgDn", "PG_DN"], ["Ins", "INS"], ["Del", "DEL"],
  ["PrtSc", "PSCRN"], ["ScrLk", "SLCK"], ["Pause", "PAUSE_BREAK"], ["Menu", "C_MENU"], ["App", "K_APP"]];
const MEDIA: [string, string][] = [["Vol +", "C_VOL_UP"], ["Vol −", "C_VOL_DN"], ["Mute", "C_MUTE"], ["Play", "C_PLAY_PAUSE"], ["Next", "C_NEXT"], ["Prev", "C_PREV"], ["Stop", "C_STOP"],
  ["FF", "C_FF"], ["Rew", "C_RW"], ["Eject", "C_EJECT"], ["Bright +", "C_BRI_INC"], ["Bright −", "C_BRI_DEC"], ["Search", "C_AC_SEARCH"], ["Browser Home", "C_AC_HOME"],
  ["Back", "C_AC_BACK"], ["Forward", "C_AC_FORWARD"], ["Refresh", "C_AC_REFRESH"], ["Calc", "C_AL_CALC"], ["Mail", "C_AL_MAIL"], ["Files", "C_AL_FILES"], ["Sleep", "C_SLEEP"]];
const NUMPAD: [string, string][] = [["Num Lock", "KP_NUM"], ["P /", "KP_SLASH"], ["P *", "KP_MULTIPLY"], ["P −", "KP_MINUS"], ["P 7", "KP_N7"], ["P 8", "KP_N8"], ["P 9", "KP_N9"], ["P +", "KP_PLUS"],
  ["P 4", "KP_N4"], ["P 5", "KP_N5"], ["P 6", "KP_N6"], ["P =", "KP_EQUAL"], ["P 1", "KP_N1"], ["P 2", "KP_N2"], ["P 3", "KP_N3"], ["P Enter", "KP_ENTER"], ["P 0", "KP_N0"], ["P .", "KP_DOT"],
  ["P ,", "KP_COMMA"], ["P (", "KP_LPAR"], ["P )", "KP_RPAR"]];
/* Shifted characters: Shift + the base key (what ZMK's EXCL, AT, … mean). */
const SYMBOLS: [string, string][] = [["!", "N1"], ["@", "N2"], ["#", "N3"], ["$", "N4"], ["%", "N5"], ["^", "N6"], ["&", "N7"], ["*", "N8"], ["(", "N9"], [")", "N0"], ["_", "MINUS"], ["+", "EQUAL"],
  ["{", "LBKT"], ["}", "RBKT"], ["|", "BSLH"], [":", "SEMI"], ["\"", "SQT"], ["<", "COMMA"], [">", "DOT"], ["?", "FSLH"], ["~", "GRAVE"]];
const MORE: [string, string][] = [["한/영", "LANG1"], ["한자", "LANG2"], ...Array.from({ length: 12 }, (_, i) => [`F${i + 13}`, `F${i + 13}`] as [string, string]),
  ["かな", "INT_KANA"], ["変換", "INT_HENKAN"], ["無変換", "INT_MUHENKAN"], ["¥", "INT_YEN"], ["ろ", "INT_RO"], ["Non-US #", "NUHS"], ["Non-US \\", "NUBS"],
  ["Caps (lock)", "LCAPS"], ["Power", "K_PWR"], ["Help", "K_HELP"], ["Undo", "K_UNDO"], ["Cut", "K_CUT"], ["Copy", "K_COPY"], ["Paste", "K_PASTE"], ["Find", "K_FIND"]];

export function ViaKeyGrid({ behaviors, layers, binding, onChange, detail, onDetail, children }: {
  behaviors: GetBehaviorDetailsResponse[]; layers: { id: number; name: string }[];
  binding: BehaviorBinding; onChange: (binding: BehaviorBinding) => void;
  detail: boolean; onDetail: (open: boolean) => void; children?: ReactNode;
}) {
  const view = useContext(RuntimeBindingsContext);
  const [tab, setTab] = useState("basic");
  const [error, setError] = useState<string | null>(null);
  const id = useMemo(() => {
    const m: Record<string, number> = {};
    for (const b of behaviors) m[norm(b.displayName)] = b.id;
    return (name: string) => m[name];
  }, [behaviors]);

  const tabs = useMemo<Tab[]>(() => {
    const kp = id("keypress");
    const keys = (list: [string, string][]) => kp === undefined ? [] : list.filter(([, k]) => usage(k) !== undefined)
      .map(([label, k]) => ({ label, title: k, binding: { behaviorId: kp, param1: usage(k)!, param2: 0 }, wide: label.length > 5 }));
    const simple = (name: string, label: string, title: string, p1 = 0, p2 = 0): Tile[] =>
      id(name) === undefined ? [] : [{ label, title, binding: { behaviorId: id(name), param1: p1, param2: p2 } }];
    const withMods = (k: string, mods: string[]) => usage(k) === undefined || kp === undefined ? undefined
      : mods.reduce((v, m) => (v | codes["__mod_" + m]) >>> 0, usage(k)!);
    const symbols: Tile[] = SYMBOLS.flatMap(([label, k]) => { const v = withMods(k, ["LS"]); return v === undefined ? [] : [{ label, title: `Shift + ${k}`, binding: { behaviorId: kp!, param1: v, param2: 0 } }]; });
    // Common shortcuts, Windows (Ctrl) and Mac (Cmd) side by side.
    const SC: [string, string, string[]][] = [[t("Copy", "복사"), "C", []], [t("Paste", "붙여넣기"), "V", []], [t("Cut", "잘라내기"), "X", []], [t("Undo", "실행 취소"), "Z", []],
      [t("Redo", "다시 실행"), "Z", ["LS"]], [t("Select all", "모두 선택"), "A", []], [t("Save", "저장"), "S", []], [t("Find", "찾기"), "F", []], [t("New tab", "새 탭"), "T", []], [t("Close tab", "탭 닫기"), "W", []]];
    const shortcuts: Tile[] = (["LC", "LG"] as const).flatMap((m) => SC.flatMap(([name, k, extra]) => {
      const v = withMods(k, [m, ...extra]);
      const who = m === "LC" ? "Win" : "Mac";
      return v === undefined ? [] : [{ label: `${name} ${who}`, title: `${m === "LC" ? "Ctrl" : "Cmd"}${extra.length ? " + Shift" : ""} + ${k}`, binding: { behaviorId: kp!, param1: v, param2: 0 }, wide: true }];
    }));
    const layerTiles = layers.flatMap((l, i) => [
      ...simple("momentarylayer", `MO ${i}`, t("Hold for layer {n}", "누르는 동안 {n}", { n: l.name || i }), i),
      ...simple("togglelayer", `TG ${i}`, t("Toggle layer {n}", "{n} 켜기/끄기", { n: l.name || i }), i),
      ...simple("tolayer", `TO ${i}`, t("Switch to layer {n}", "{n}로 전환", { n: l.name || i }), i),
    ]);
    // Ryong firmware's slot key: tap selects the slot, hold 3 s clears it for a new pairing.
    // Older firmware only has ZMK's plain "select" (&bt BT_SEL).
    const slotKeys = [0, 1, 2, 3, 4].flatMap(n => simple("bluetoothslot", `BT ${n + 1}`,
      t("Slot {n}: tap to select, hold 3 s to clear it for a new pairing", "슬롯 {n}: 누르면 선택, 3초 누르면 등록 삭제(새로 페어링)", { n: n + 1 }), n));
    const bt = slotKeys.length ? slotKeys
      : [0, 1, 2, 3, 4].flatMap(n => simple("bluetooth", `BT ${n + 1}`, t("Select Bluetooth slot {n}", "Bluetooth 슬롯 {n} 선택", { n: n + 1 }), codes.__bt_BT_SEL, n));
    const bt2 = [
      ...simple("bluetooth", t("Next", "다음"), t("Next slot", "다음 슬롯"), codes.__bt_BT_NXT),
      ...simple("bluetooth", t("Prev", "이전"), t("Previous slot", "이전 슬롯"), codes.__bt_BT_PRV),
      ...simple("bluetooth", t("Clear", "현재 삭제"), t("Clear selected slot", "선택한 슬롯 등록 삭제"), codes.__bt_BT_CLR),
      ...simple("outputselection", "USB", t("Send keys over USB", "USB로 출력"), codes.__out_OUT_USB),
      ...simple("outputselection", "BLE", t("Send keys over Bluetooth", "Bluetooth로 출력"), codes.__out_OUT_BLE),
      ...simple("outputselection", "USB↔BLE", t("Toggle output", "출력 전환"), codes.__out_OUT_TOG),
    ];
    const special = [
      ...simple("graveescape", "Esc · `", t("Esc, or ` with Shift/GUI", "Esc, Shift·GUI와 함께면 `")),
      ...simple("backspacedelete", "Bksp · Del", t("Backspace, or Delete with Shift", "Backspace, Shift와 함께면 Delete")),
      ...simple("osadaptivekey", t("OS Alt/Cmd", "OS Alt/Cmd"), t("Alt on Windows, Command on Apple", "Windows는 Alt, Apple은 Command"), usage("LALT"), usage("LGUI")),
      ...simple("osadaptivekey", t("OS Win/Opt", "OS Win/Opt"), t("Win on Windows, Option on Apple", "Windows는 Win, Apple은 Option"), usage("LGUI"), usage("LALT")),
      ...simple("transparent", "▽", t("Transparent: use the layer below", "투명: 아래 레이어 키 사용")),
      ...simple("none", "✕", t("Do nothing", "아무 동작 없음")),
      ...simple("capsword", "Caps Word", "Caps Word"),
      ...simple("keyrepeat", t("Repeat", "반복"), "Key Repeat"),
      ...simple("studiounlock", t("Unlock", "잠금 해제"), "Studio Unlock"),
      ...simple("bootloader", "Boot", t("Bootloader (firmware update drive)", "부트로더(펌웨어 드라이브)")),
      ...simple("reset", "Reset", t("Restart keyboard", "키보드 재시작")),
      ...simple("softoff", t("Power off", "전원 끄기"), "Soft Off"),
      ...simple("bleupdate", t("BT update", "BT 업데이트"), t("Restart into Bluetooth firmware update mode (development)", "Bluetooth 펌웨어 업데이트 모드로 다시 시작 (개발용)")),
    ];
    // Lights: only what this keyboard's firmware has (ZMK &bl / &rgb_ug commands, dt-bindings/zmk/*.h).
    const lights: Tile[] = [
      ...simple("backlight", t("BL on/off", "백라이트 켜기/끄기"), t("Backlight on/off", "백라이트 켜기/끄기"), 2),
      ...simple("backlight", t("BL +", "백라이트 밝게"), t("Backlight brighter", "백라이트 밝게"), 3),
      ...simple("backlight", t("BL −", "백라이트 어둡게"), t("Backlight dimmer", "백라이트 어둡게"), 4),
      ...simple("backlight", t("BL step", "백라이트 단계"), t("Backlight: next brightness step", "백라이트 밝기 단계 돌리기"), 5),
      ...simple("underglow", t("RGB on/off", "언더글로우 켜기/끄기"), t("Underglow on/off", "언더글로우 켜기/끄기"), 0),
      ...simple("underglow", t("RGB +", "언더글로우 밝게"), t("Underglow brighter", "언더글로우 밝게"), 7),
      ...simple("underglow", t("RGB −", "언더글로우 어둡게"), t("Underglow dimmer", "언더글로우 어둡게"), 8),
      ...simple("underglow", t("Effect ▶", "효과 다음"), t("Underglow: next effect", "언더글로우 효과 다음"), 11),
      ...simple("underglow", t("Effect ◀", "효과 이전"), t("Underglow: previous effect", "언더글로우 효과 이전"), 12),
      ...simple("underglow", t("Hue +", "색 +"), t("Underglow: hue up", "언더글로우 색상 +"), 3),
      ...simple("underglow", t("Hue −", "색 −"), t("Underglow: hue down", "언더글로우 색상 −"), 4),
      ...simple("underglow", t("Sat +", "채도 +"), t("Underglow: saturation up", "언더글로우 채도 +"), 5),
      ...simple("underglow", t("Sat −", "채도 −"), t("Underglow: saturation down", "언더글로우 채도 −"), 6),
      ...simple("underglow", t("Speed +", "속도 +"), t("Underglow: effect faster", "언더글로우 속도 +"), 9),
      ...simple("underglow", t("Speed −", "속도 −"), t("Underglow: effect slower", "언더글로우 속도 −"), 10),
    ].map((x) => ({ ...x, wide: true }));
    const dynamic: Tile[] = namedRuntimeBindings(view).map(c => ({ label: c.label, title: c.kind === "macro" ? t("Macro", "매크로") : t("Tap Dance", "탭댄스"),
      binding: c.binding, wide: true, key: c.key } as Tile & { key: string }));
    return [
      { id: "basic", label: t("Basic", "기본"), tiles: keys(BASIC) },
      { id: "mods", label: t("Modifiers", "수정키"), tiles: keys(MODS) },
      { id: "nav", label: t("Navigation", "이동·편집"), tiles: keys(NAV) },
      { id: "symbols", label: t("Symbols", "기호"), tiles: symbols },
      { id: "numpad", label: t("Numpad", "숫자패드"), tiles: keys(NUMPAD) },
      { id: "media", label: t("Media", "미디어"), tiles: keys(MEDIA) },
      { id: "shortcuts", label: t("Shortcuts", "단축키"), tiles: shortcuts },
      { id: "more", label: t("F13–24 · Language", "F13–24·언어"), tiles: keys(MORE) },
      { id: "layers", label: t("Layers", "레이어"), tiles: layerTiles },
      // Built in the panel below (tap key + hold modifier/layer), not a fixed tile list.
      ...(id("modtap") !== undefined || id("layertap") !== undefined ? [{ id: "holdtap", label: t("Tap · Hold", "탭·홀드"), tiles: [] as Tile[] }] : []),
      { id: "bt", label: "Bluetooth", tiles: [...bt, ...bt2] },
      { id: "lights", label: t("Lights", "조명"), tiles: lights },
      { id: "special", label: t("Special", "특수"), tiles: special },
      { id: "dynamic", label: t("Macro · Tap Dance", "매크로·탭댄스"), tiles: dynamic },
    ].filter(x => x.tiles.length || x.id === "holdtap");
  }, [id, layers, view]);

  const current = tabs.find(x => x.id === tab) ?? tabs[0];
  if (!current) return null;
  const same = (b: BehaviorBinding) => b.behaviorId === binding.behaviorId && b.param1 === binding.param1 && b.param2 === binding.param2;
  const onGrid = tabs.some(x => x.tiles.some(tile => same(tile.binding))) || (binding.behaviorId === id("modtap") || binding.behaviorId === id("layertap"));
  const currentName = behaviors.find(b => b.id === binding.behaviorId)?.displayName ?? t("Unknown action", "알 수 없는 동작");
  const size = (label: string) => label.length > 7 ? " is-2u" : label.length > 3 ? " is-15u" : "";
  return <div className="ry-via">
    <nav className="ry-via-cats" aria-label={t("Key categories", "키 종류")}>
      <div role="tablist" className="ry-via-catlist">
        {tabs.map(x => <button key={x.id} role="tab" className="ry-via-cat" aria-selected={!detail && x.id === current.id}
          onClick={() => { setTab(x.id); onDetail(false); }}>{x.label}</button>)}
      </div>
      <button className="ry-via-cat ry-via-detail-toggle" aria-pressed={detail} onClick={() => onDetail(!detail)}>
        {t("Detailed settings", "세부 설정")}</button>
    </nav>
    <div className="ry-via-body">
      {detail ? <div className="ry-via-detail">{children}</div>
        : current.id === "holdtap" ? <HoldTapBuilder key={`${binding.behaviorId}:${binding.param1}:${binding.param2}`} keyPress={id("keypress")} modTap={id("modtap")} layerTap={id("layertap")} layers={layers} binding={binding} onChange={onChange} />
        : <div className="ry-via-grid" role="tabpanel" aria-label={current.label}>
          {current.tiles.map((tile, i) => <button key={i} className={"ry-via-key" + size(tile.label)} title={tile.title} aria-pressed={same(tile.binding)}
            onClick={async () => {
              setError(null);
              const key = (tile as Tile & { key?: string }).key;
              try { onChange(key && view ? await checkedRuntimeBinding(view, key) : tile.binding); }
              catch (e) { setError(e instanceof Error ? e.message : String(e)); }
            }}>{tile.label}</button>)}
        </div>}
      {/* fixed-height status line: the panel never changes size */}
      <p className="ry-via-current" aria-live="polite">
        {error ? <span className="ry-danger">{error}</span>
          : !onGrid && !detail ? <>{t("Current: {name}. Change its options in detailed settings.", "현재 할당: {name} · 세부 옵션은 세부 설정에서 바꿉니다.", { name: currentName })}
            <button className="ry-text" onClick={() => onDetail(true)}>{t("Open", "열기")}</button></> : null}
      </p>
    </div>
  </div>;
}

/* Tap keys offered for Mod-Tap / Layer-Tap (ZMK's hold-tap sends a plain key on tap). */
const TAP_KEYS: [string, string][] = ([...BASIC, ...NAV, ["Bksp", "BSPC"], ["Del", "DEL"], ["Esc", "ESC"], ["Tab", "TAB"], ["Enter", "RET"], ["Space", "SPACE"], ["한/영", "LANG1"], ["한자", "LANG2"], ...MODS] as [string, string][])
  .filter(([, k], i, all) => usage(k) !== undefined && all.findIndex(([, x]) => x === k) === i);

function HoldTapBuilder({ keyPress, modTap, layerTap, layers, binding, onChange }: {
  keyPress?: number; modTap?: number; layerTap?: number; layers: { id: number; name: string }[];
  binding: BehaviorBinding; onChange: (binding: BehaviorBinding) => void;
}) {
  // One "hold" list (modifiers and layers together): which ZMK behavior that needs is our job.
  const isLt = layerTap !== undefined && binding.behaviorId === layerTap;
  const isMt = modTap !== undefined && binding.behaviorId === modTap;
  // Tap = the key that is already there (F stays F when tapped), unless it is already a tap·hold.
  const own = keyPress !== undefined && binding.behaviorId === keyPress && TAP_KEYS.some(([, k]) => usage(k) === binding.param1) ? binding.param1 : undefined;
  const [tap, setTap] = useState<number>(isLt || isMt ? binding.param2 : own ?? usage("F")!);
  const [hold, setHold] = useState<string>(isMt ? `m${binding.param1}` : isLt ? `l${binding.param1}` : modTap !== undefined ? `m${usage("LSHFT")}` : "l1");
  const tapName = TAP_KEYS.find(([, k]) => usage(k) === tap)?.[0] ?? "?";
  const holdIsLayer = hold.startsWith("l");
  const holdVal = Number(hold.slice(1));
  const holdName = holdIsLayer ? (layers[holdVal]?.name || t("Layer {n}", "레이어 {n}", { n: holdVal })) : MODS.find(([, k]) => usage(k) === holdVal)?.[0] ?? "?";
  const next: BehaviorBinding | undefined = holdIsLayer ? (layerTap === undefined ? undefined : { behaviorId: layerTap, param1: holdVal, param2: tap })
    : (modTap === undefined ? undefined : { behaviorId: modTap, param1: holdVal, param2: tap });
  const applied = !!next && next.behaviorId === binding.behaviorId && next.param1 === binding.param1 && next.param2 === binding.param2;
  return <div className="ry-via-detail ry-holdtap" role="tabpanel" aria-label={t("Tap · Hold", "탭·홀드")}>
    <p className="ry-faint">{t("One key, two jobs. E.g. F: tap types F, hold works as Shift (or switches to a layer while held).",
      "키 하나에 두 역할. 예: F를 짧게 누르면 F, 길게 누르면 Shift (또는 누르는 동안 다른 레이어). 판단 시간은 탭·홀드 탭에서 바꿔요.")}</p>
    <label className="ry-field">{t("Tap", "짧게 누르면")}
      <select value={tap} onChange={(e) => setTap(Number(e.target.value))}>
        {TAP_KEYS.map(([label, k]) => <option key={k} value={usage(k)}>{label}</option>)}
      </select></label>
    <label className="ry-field">{t("Hold", "길게 누르면")}
      <select value={hold} onChange={(e) => setHold(e.target.value)}>
        {modTap !== undefined && <optgroup label={t("Modifier", "수정키")}>
          {MODS.map(([label, k]) => <option key={k} value={`m${usage(k)}`}>{label}</option>)}</optgroup>}
        {layerTap !== undefined && <optgroup label={t("Layer (while held)", "레이어 (누르는 동안)")}>
          {layers.map((l, i) => <option key={l.id} value={`l${i}`}>{l.name || t("Layer {n}", "레이어 {n}", { n: i })}</option>)}</optgroup>}
      </select></label>
    <div className="ry-row">
      <span>{t("Tap {tap} · hold {hold}", "짧게 {tap} · 길게 {hold}", { tap: tapName, hold: holdName })}</span>
      <button className="ry-primary" disabled={!next || applied} onClick={() => next && onChange(next)}>
        {applied ? t("Assigned", "적용됨") : t("Assign to this key", "이 키에 적용")}</button>
    </div>
  </div>;
}
