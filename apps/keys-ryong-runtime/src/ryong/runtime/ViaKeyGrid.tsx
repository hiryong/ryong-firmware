import { useContext, useMemo, useState } from "react";
import type { BehaviorBinding } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import type { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import values from "./keycode-values.json";
import { RuntimeBindingsContext, namedRuntimeBindings, checkedRuntimeBinding } from "./bindings";
import { t } from "../i18n";

/** VIA-style picker: click a tile and the selected key gets it. The Studio dropdowns stay below for full control. */
const codes = values as Record<string, number>;
const HEX: Record<string, number> = { LBKT: 0x7002f, RBKT: 0x70030, C_BRI_DEC: 0xc0070, C_BRI_INC: 0xc006f };
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
const NAV: [string, string][] = [["↑", "UP"], ["↓", "DOWN"], ["←", "LEFT"], ["→", "RIGHT"], ["Home", "HOME"], ["End", "END"], ["PgUp", "PG_UP"], ["PgDn", "PG_DN"], ["Ins", "INS"], ["Del", "DEL"], ["PrtSc", "PSCRN"], ["Menu", "C_MENU"]];
const MEDIA: [string, string][] = [["Vol +", "C_VOL_UP"], ["Vol −", "C_VOL_DN"], ["Mute", "C_MUTE"], ["Play", "C_PLAY_PAUSE"], ["Next", "C_NEXT"], ["Prev", "C_PREV"], ["Bright +", "C_BRI_INC"], ["Bright −", "C_BRI_DEC"], ["Search", "C_AC_SEARCH"]];

export function ViaKeyGrid({ behaviors, layers, binding, onChange, detail, onDetail }: {
  behaviors: GetBehaviorDetailsResponse[]; layers: { id: number; name: string }[];
  binding: BehaviorBinding; onChange: (binding: BehaviorBinding) => void;
  detail: boolean; onDetail: (open: boolean) => void;
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
    const layerTiles = layers.flatMap((l, i) => [
      ...simple("momentarylayer", `MO ${i}`, t("Hold for layer {n}", "누르는 동안 {n}", { n: l.name || i }), i),
      ...simple("togglelayer", `TG ${i}`, t("Toggle layer {n}", "{n} 켜기/끄기", { n: l.name || i }), i),
      ...simple("tolayer", `TO ${i}`, t("Switch to layer {n}", "{n}로 전환", { n: l.name || i }), i),
    ]);
    const bt = [0, 1, 2, 3, 4].flatMap(n => simple("bluetooth", `BT ${n + 1}`, t("Select Bluetooth slot {n}", "Bluetooth 슬롯 {n} 선택", { n: n + 1 }), codes.__bt_BT_SEL, n));
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
    ];
    const dynamic: Tile[] = namedRuntimeBindings(view).map(c => ({ label: c.label, title: c.kind === "macro" ? t("Macro", "매크로") : t("Tap Dance", "탭댄스"),
      binding: c.binding, wide: true, key: c.key } as Tile & { key: string }));
    return [
      { id: "basic", label: t("Basic", "기본"), tiles: keys(BASIC) },
      { id: "mods", label: t("Modifiers", "수정키"), tiles: keys(MODS) },
      { id: "nav", label: t("Navigation", "이동·편집"), tiles: keys(NAV) },
      { id: "media", label: t("Media", "미디어"), tiles: keys(MEDIA) },
      { id: "layers", label: t("Layers", "레이어"), tiles: layerTiles },
      { id: "bt", label: "Bluetooth", tiles: [...bt, ...bt2] },
      { id: "special", label: t("Special", "특수"), tiles: special },
      { id: "dynamic", label: t("Macro · Tap Dance", "매크로·탭댄스"), tiles: dynamic },
    ].filter(x => x.tiles.length);
  }, [id, layers, view]);

  const current = tabs.find(x => x.id === tab) ?? tabs[0];
  if (!current) return null;
  const same = (b: BehaviorBinding) => b.behaviorId === binding.behaviorId && b.param1 === binding.param1 && b.param2 === binding.param2;
  const onGrid = tabs.some(x => x.tiles.some(tile => same(tile.binding)));
  const currentName = behaviors.find(b => b.id === binding.behaviorId)?.displayName ?? t("Unknown action", "알 수 없는 동작");
  return <div className="ry-via">
    <div className="ry-via-tabs">
      <div className="ry-via-tablist" role="tablist" aria-label={t("Key categories", "키 종류")}>
        {tabs.map(x => <button key={x.id} role="tab" className="ry-chip" aria-pressed={x.id === current.id} aria-selected={x.id === current.id} onClick={() => setTab(x.id)}>{x.label}</button>)}
      </div>
      <button className="ry-text" aria-expanded={detail} onClick={() => onDetail(!detail)}>
        {detail ? t("Hide detailed settings", "세부 설정 닫기") : t("Detailed settings", "세부 설정")}</button>
    </div>
    <div className="ry-via-grid" role="tabpanel" aria-label={current.label}>
      {current.tiles.map((tile, i) => <button key={i} className={"ry-via-key" + (tile.wide ? " is-wide" : "")} title={tile.title} aria-pressed={same(tile.binding)}
        onClick={async () => {
          setError(null);
          const key = (tile as Tile & { key?: string }).key;
          try { onChange(key && view ? await checkedRuntimeBinding(view, key) : tile.binding); }
          catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        }}>{tile.label}</button>)}
    </div>
    {/* always present with a fixed height, so the area below never jumps */}
    <p className="ry-via-current" aria-live="polite">{!onGrid && !detail && <>
      {t("Current: {name}. Its options are in detailed settings.", "현재 할당: {name}. 세부 옵션은 세부 설정에서 바꿀 수 있습니다.", { name: currentName })}
      <button className="ry-text" onClick={() => onDetail(true)}>{t("Open", "열기")}</button></>}</p>
    {error && <p role="alert" className="ry-note ry-danger">{error}</p>}
  </div>;
}
