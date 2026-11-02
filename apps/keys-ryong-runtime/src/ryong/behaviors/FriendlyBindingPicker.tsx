import { useEffect, useMemo, useState } from "react";
import { t } from "../i18n";
import type { Binding, BehaviorDoc, Mod } from "./model";
import { bindingLabel } from "./model";
import { BindingPicker } from "./BindingPicker";
import keycodes from "./keycodes.json";

/**
 * "What should it type?" for regular people. Instead of a list of ZMK behavior names:
 * press the key on your keyboard, or pick from plain categories. The full ZMK picker
 * stays one click away under "More options".
 */
const KNOWN = new Set((keycodes as { id: string }[]).map((k) => k.id));
const NICE: Record<string, string> = {
  RET: "Enter", ESC: "Esc", BSPC: "Backspace", TAB: "Tab", SPACE: "Space", DEL: "Delete", INS: "Insert", CAPS: "Caps Lock",
  PSCRN: "Print Screen", HOME: "Home", END: "End", PG_UP: "Page Up", PG_DN: "Page Down", LEFT: "←", RIGHT: "→", UP: "↑", DOWN: "↓",
  MINUS: "-", EQUAL: "=", LBKT: "[", RBKT: "]", BSLH: "\\", SEMI: ";", SQT: "'", GRAVE: "`", COMMA: ",", DOT: ".", FSLH: "/",
  C_VOL_UP: "Vol +", C_VOL_DN: "Vol −", C_MUTE: "Mute", C_PP: "Play/Pause", C_NEXT: "Next", C_PREV: "Prev", C_MENU: "Menu",
  LCTRL: "Ctrl", LSHFT: "Shift", LALT: "Alt", LGUI: "Win / ⌘", RCTRL: "R Ctrl", RSHFT: "R Shift", RALT: "R Alt", RGUI: "R Win / ⌘",
  LANG1: "한/영", LANG2: "한자",
};
const MODS_NICE: Record<Mod, string> = { LC: "Ctrl", LS: "Shift", LA: "Alt", LG: "⌘/Win", RC: "Ctrl", RS: "Shift", RA: "Alt", RG: "⌘/Win" };
const keyNice = (id: string) => NICE[id] ?? (id.startsWith("N") && id.length === 2 ? id.slice(1) : id);

export function friendlyLabel(b: Binding, doc?: BehaviorDoc, layers: string[] = []): string {
  const layer = (n: number) => layers[n] ?? t("Layer {n}", "레이어 {n}", { n });
  switch (b.b) {
    case "kp": return [...(b.mods ?? []).map((m) => MODS_NICE[m]), keyNice(b.key)].join(" + ");
    case "mo": return t("Hold for {l}", "누르는 동안 {l}", { l: layer(b.layer) });
    case "tog": return t("{l} on/off", "{l} 켜기/끄기", { l: layer(b.layer) });
    case "to": return t("Switch to {l}", "{l}로 전환", { l: layer(b.layer) });
    case "bt": {
      const [c, n] = b.cmd.split(" ");
      return c === "BT_SEL" ? t("Bluetooth {n}", "Bluetooth {n}", { n: Number(n) + 1 }) : c === "BT_NXT" ? t("Next Bluetooth", "다음 Bluetooth")
        : c === "BT_PRV" ? t("Previous Bluetooth", "이전 Bluetooth") : bindingLabel(b, doc, layers);
    }
    case "out": return b.cmd === "OUT_USB" ? t("Use USB", "USB로 입력") : b.cmd === "OUT_BLE" ? t("Use Bluetooth", "Bluetooth로 입력") : t("Switch USB / Bluetooth", "USB↔Bluetooth 전환");
    case "caps_word": return t("Caps Word", "단어 대문자");
    case "none": return t("Nothing", "아무것도 안 함");
    default: return bindingLabel(b, doc, layers);
  }
}

/** KeyboardEvent.code → ZMK key name */
const CODE: Record<string, string> = {
  Enter: "RET", Escape: "ESC", Backspace: "BSPC", Tab: "TAB", Space: "SPACE", Minus: "MINUS", Equal: "EQUAL", Backslash: "BSLH",
  Semicolon: "SEMI", Quote: "SQT", Backquote: "GRAVE", BracketLeft: "LBKT", BracketRight: "RBKT", Comma: "COMMA", Period: "DOT", Slash: "FSLH", CapsLock: "CAPS",
  ArrowLeft: "LEFT", ArrowRight: "RIGHT", ArrowUp: "UP", ArrowDown: "DOWN", Home: "HOME", End: "END", PageUp: "PG_UP", PageDown: "PG_DN",
  Insert: "INS", Delete: "DEL", PrintScreen: "PSCRN", ContextMenu: "K_APP", Lang1: "LANG1", Lang2: "LANG2",
  ShiftLeft: "LSHFT", ShiftRight: "RSHFT", ControlLeft: "LCTRL", ControlRight: "RCTRL", AltLeft: "LALT", AltRight: "RALT", MetaLeft: "LGUI", MetaRight: "RGUI",
};
function fromEvent(e: KeyboardEvent): Binding | null {
  let id = CODE[e.code];
  if (!id && /^Key[A-Z]$/.test(e.code)) id = e.code.slice(3);
  if (!id && /^Digit\d$/.test(e.code)) id = "N" + e.code.slice(5);
  if (!id && /^F\d{1,2}$/.test(e.code)) id = e.code;
  if (!id || !KNOWN.has(id)) return null;
  const isMod = /^(L|R)(CTRL|SHFT|ALT|GUI)$/.test(id);
  const mods: Mod[] = isMod ? [] : [e.ctrlKey && "LC", e.shiftKey && "LS", e.altKey && "LA", e.metaKey && "LG"].filter(Boolean) as Mod[];
  return mods.length ? { b: "kp", key: id, mods } : { b: "kp", key: id };
}

type Tile = { label: string; hint?: string; binding: Binding };
const kp = (key: string, mods?: Mod[]): Binding => (mods ? { b: "kp", key, mods } : { b: "kp", key });

export function FriendlyBindingPicker({ value, onChange, doc, layerNames, exclude, compact }: {
  value: Binding; onChange: (b: Binding) => void; doc: BehaviorDoc; layerNames: string[]; exclude?: string; compact?: boolean;
}) {
  const [open, setOpen] = useState(!compact);
  const [cat, setCat] = useState("common");
  const [listening, setListening] = useState(false);
  const [mac, setMac] = useState(() => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  const [note, setNote] = useState<string | null>(null);
  const layers = layerNames.length ? layerNames : [0, 1, 2, 3].map((n) => t("Layer {n}", "레이어 {n}", { n }));

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.repeat) return;
      // A lone modifier waits for the next key; release it alone to assign the modifier itself.
      if (/^(Shift|Control|Alt|Meta)/.test(e.code) && e.type === "keydown") return;
      const b = fromEvent(e);
      if (b) { onChange(b); setNote(null); } else setNote(t("That key isn't available yet. Pick it from the list below.", "그 키는 아직 지원하지 않아요. 아래 목록에서 골라 주세요."));
      setListening(false);
    };
    const onUp = (e: KeyboardEvent) => {
      if (!/^(Shift|Control|Alt|Meta)/.test(e.code)) return;
      e.preventDefault();
      const b = fromEvent(e); if (b) onChange(b); setListening(false);
    };
    window.addEventListener("keydown", onKey, true); window.addEventListener("keyup", onUp, true);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("keyup", onUp, true); };
  }, [listening, onChange]);

  const cats = useMemo(() => {
    const cmd: Mod = mac ? "LG" : "LC";
    const list: { id: string; label: string; tiles: Tile[] }[] = [
      { id: "common", label: t("Common keys", "자주 쓰는 키"), tiles: ["ESC", "RET", "TAB", "BSPC", "DEL", "SPACE", "LEFT", "DOWN", "UP", "RIGHT", "HOME", "END", "PG_UP", "PG_DN", "CAPS", "PSCRN", "LANG1", "LANG2"].map((k) => ({ label: keyNice(k), binding: kp(k) })) },
      { id: "shortcut", label: t("Shortcuts", "단축키"), tiles: ([
        [t("Copy", "복사"), "C"], [t("Paste", "붙여넣기"), "V"], [t("Cut", "잘라내기"), "X"], [t("Undo", "실행 취소"), "Z"],
        [t("Select all", "모두 선택"), "A"], [t("Save", "저장"), "S"], [t("Find", "찾기"), "F"], [t("New tab", "새 탭"), "T"], [t("Close tab", "탭 닫기"), "W"],
      ] as [string, string][]).map(([label, k]) => ({ label, hint: `${MODS_NICE[cmd]} + ${k}`, binding: kp(k, [cmd]) }))
        .concat([{ label: t("Redo", "다시 실행"), hint: mac ? "⌘ + Shift + Z" : "Ctrl + Y", binding: mac ? kp("Z", ["LG", "LS"]) : kp("Y", ["LC"]) }]) },
      { id: "chars", label: t("Letters & numbers", "문자·숫자"), tiles: [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((c) => ({ label: c, binding: kp(c) }))
        .concat([..."1234567890"].map((n) => ({ label: n, binding: kp("N" + n) })))
        .concat(["MINUS", "EQUAL", "LBKT", "RBKT", "BSLH", "SEMI", "SQT", "GRAVE", "COMMA", "DOT", "FSLH"].map((k) => ({ label: keyNice(k), binding: kp(k) })))
        .concat(Array.from({ length: 12 }, (_, i) => ({ label: `F${i + 1}`, binding: kp(`F${i + 1}`) }))) },
      { id: "media", label: t("Volume & media", "볼륨·미디어"), tiles: ([
        [t("Volume up", "볼륨 크게"), "C_VOL_UP"], [t("Volume down", "볼륨 작게"), "C_VOL_DN"], [t("Mute", "음소거"), "C_MUTE"],
        [t("Play / pause", "재생/정지"), "C_PP"], [t("Next", "다음 곡"), "C_NEXT"], [t("Previous", "이전 곡"), "C_PREV"],
      ] as [string, string][]).map(([label, k]) => ({ label, hint: keyNice(k), binding: kp(k) })) },
      { id: "mods", label: t("Modifier keys", "보조키"), tiles: ["LCTRL", "LSHFT", "LALT", "LGUI", "RCTRL", "RSHFT", "RALT", "RGUI"].map((k) => ({ label: keyNice(k), binding: kp(k) })) },
      { id: "layers", label: t("Layers", "레이어"), tiles: layers.flatMap((_, i) => [
        { label: friendlyLabel({ b: "mo", layer: i }, doc, layers), binding: { b: "mo", layer: i } as Binding },
        { label: friendlyLabel({ b: "tog", layer: i }, doc, layers), binding: { b: "tog", layer: i } as Binding },
      ]) },
      { id: "bt", label: "Bluetooth", tiles: [0, 1, 2, 3, 4].map((n) => ({ label: friendlyLabel({ b: "bt", cmd: `BT_SEL ${n}` }), binding: { b: "bt", cmd: `BT_SEL ${n}` } as Binding }))
        .concat([{ b: "bt", cmd: "BT_NXT" }, { b: "out", cmd: "OUT_TOG" }].map((b) => ({ label: friendlyLabel(b as Binding), binding: b as Binding }))) },
    ];
    const refs = [...doc.macros, ...doc.tapDances].filter((x) => x.id !== exclude);
    if (refs.length) list.push({ id: "mine", label: t("My macros & tap dances", "내 매크로·탭댄스"),
      tiles: refs.map((r) => ({ label: r.name, hint: doc.macros.includes(r as never) ? t("Macro", "매크로") : t("Tap dance", "탭댄스"), binding: { b: "ref", id: r.id } })) });
    return list.map((c) => ({ ...c, tiles: c.tiles.filter((x) => x.binding.b !== "kp" || KNOWN.has(x.binding.key)) }));
  }, [mac, layers.join("|"), doc.macros, doc.tapDances, exclude]);

  const same = (a: Binding) => JSON.stringify(a) === JSON.stringify(value);
  const current = cats.find((c) => c.id === cat) ?? cats[0];
  return (
    <div className="ry-fb">
      <div className="ry-fb-current">
        <span className="ry-fb-cap" aria-live="polite">{friendlyLabel(value, doc, layers)}</span>
        <button className={"ry-fb-listen" + (listening ? " is-on" : "")} onClick={() => { setNote(null); setListening((x) => !x); setOpen(true); }}>
          {listening ? t("Press a key now… (click to cancel)", "지금 키를 누르세요… (누르면 취소)") : t("Press the key on your keyboard", "키보드로 직접 누르기")}
        </button>
        {compact && <button className="ry-text" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? t("Close", "닫기") : t("Choose from list", "목록에서 고르기")}</button>}
      </div>
      {note && <p className="ry-faint ry-danger">{note}</p>}
      {open && <>
        <div className="ry-fb-cats" role="tablist">
          {cats.map((c) => <button key={c.id} role="tab" aria-selected={c.id === current.id} onClick={() => setCat(c.id)}>{c.label}</button>)}
          <button role="tab" aria-selected={cat === "more"} onClick={() => setCat("more")}>{t("More options", "기타 (고급)")}</button>
        </div>
        {cat === "shortcut" && <div className="ry-fb-os">
          <button aria-pressed={!mac} onClick={() => setMac(false)}>Windows</button><button aria-pressed={mac} onClick={() => setMac(true)}>Mac</button>
        </div>}
        {cat === "more" ? <div className="ry-fb-more">
          <p className="ry-faint">{t("Every ZMK action, for advanced use.", "ZMK의 모든 동작입니다. 익숙한 분만 쓰세요.")}</p>
          <BindingPicker value={value} onChange={onChange} doc={doc} layerNames={layerNames} exclude={exclude} />
        </div> : <div className="ry-fb-grid">
          {current.tiles.map((x, i) => <button key={i} className={"ry-fb-tile" + (x.label.length > 6 ? " is-wide" : "")} aria-pressed={same(x.binding)}
            onClick={() => onChange(x.binding)} title={x.hint}>
            <span>{x.label}</span>{x.hint && <small>{x.hint}</small>}
          </button>)}
        </div>}
      </>}
    </div>
  );
}
