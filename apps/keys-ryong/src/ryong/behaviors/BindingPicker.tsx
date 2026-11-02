import { useEffect, useMemo, useRef, useState } from "react";
import keycodes from "./keycodes.json";
import { Binding, BehaviorDoc, BT_CMDS, btLabel, Mod, MOD_LABEL, OUT_CMDS, outLabel } from "./model";
import { t } from "../i18n";

type KC = { id: string; n: string[]; d: string; p: string };
const KEYCODES = keycodes as KC[];

// Most-used keys first, so an empty search is still useful.
const COMMON = "A B C D E F G H I J K L M N O P Q R S T U V W X Y Z N1 N2 N3 N4 N5 N6 N7 N8 N9 N0 RET ESC BSPC TAB SPACE DEL LEFT RIGHT UP DOWN HOME END PG_UP PG_DN LSHFT LCTRL LALT LGUI MINUS EQUAL LBKT RBKT BSLH SEMI SQT GRAVE COMMA DOT FSLH CAPS F1 F2 F3 F4 F5 F6 F7 F8 F9 F10 F11 F12 PSCRN INS C_VOL_UP C_VOL_DN C_MUTE C_PP C_NEXT C_PREV C_BRI_UP C_BRI_DN LANG1 LANG2".split(" ");

// The names ZMK gives these behaviors (what the key editor shows), not our own wording.
const KINDS: { v: Binding["b"]; label: () => string }[] = [
  { v: "kp", label: () => "Key Press" },
  { v: "ref", label: () => t("My macros & tap dances", "내 매크로·탭댄스") },
  { v: "mo", label: () => "Momentary Layer" },
  { v: "tog", label: () => "Toggle Layer" },
  { v: "to", label: () => "To Layer" },
  { v: "sl", label: () => "Sticky Layer" },
  { v: "sk", label: () => "Sticky Key" },
  { v: "caps_word", label: () => "Caps Word" },
  { v: "key_repeat", label: () => "Key Repeat" },
  { v: "bt", label: () => "Bluetooth" },
  { v: "out", label: () => "Output Selection" },
  { v: "studio_unlock", label: () => "Studio Unlock" },
  { v: "bootloader", label: () => "Bootloader" },
  { v: "sys_reset", label: () => "Reset" },
  { v: "trans", label: () => "Transparent" },
  { v: "none", label: () => "None" },
  { v: "raw", label: () => t("Custom (ZMK code)", "직접 입력 (ZMK 코드)") },
];

export function defaultBinding(kind: Binding["b"], doc?: BehaviorDoc): Binding {
  switch (kind) {
    case "kp":
    case "sk":
      return { b: kind, key: "", mods: [] };
    case "mo":
    case "tog":
    case "to":
    case "sl":
      return { b: kind, layer: 1 };
    case "bt":
      return { b: "bt", cmd: "BT_NXT" };
    case "out":
      return { b: "out", cmd: "OUT_TOG" };
    case "ref":
      return { b: "ref", id: doc?.macros[0]?.id ?? doc?.tapDances[0]?.id ?? "" };
    case "raw":
      return { b: "raw", text: "&mt LSHFT A" };
    default:
      return { b: kind } as Binding;
  }
}

export interface BindingPickerProps {
  value: Binding;
  onChange: (b: Binding) => void;
  doc: BehaviorDoc;
  layerNames: string[];
  /** ids that must not be offered (an item can't contain itself) */
  exclude?: string;
  compact?: boolean;
}

export const BindingPicker = ({ value, onChange, doc, layerNames, exclude }: BindingPickerProps) => {
  const refs = [
    ...doc.macros.map((m) => ({ ...m, kind: t("Macro", "매크로") })),
    ...doc.tapDances.map((td) => ({ ...td, kind: t("Tap dance", "탭댄스") })),
  ].filter((x) => x.id !== exclude);
  const layers = layerNames.length ? layerNames : [0, 1, 2, 3].map((n) => t("Layer {n}", "레이어 {n}", { n }));

  return (
    <div className="ry-bind">
      <select
        aria-label={t("Action", "동작")}
        value={value.b}
        onChange={(e) => onChange(defaultBinding(e.target.value as Binding["b"], doc))}
      >
        {KINDS.filter((k) => k.v !== "ref" || refs.length || value.b === "ref").map((k) => (
          <option key={k.v} value={k.v}>
            {k.label()}
          </option>
        ))}
      </select>

      {(value.b === "kp" || value.b === "sk") && (
        <>
          <KeyPicker value={value.key} onChange={(key) => onChange({ ...value, key })} />
          <ModToggles value={value.mods ?? []} onChange={(mods) => onChange({ ...value, mods })} />
        </>
      )}

      {(value.b === "mo" || value.b === "tog" || value.b === "to" || value.b === "sl") && (
        <select aria-label={t("Layer", "레이어")} value={value.layer} onChange={(e) => onChange({ ...value, layer: Number(e.target.value) })}>
          {layers.map((n, i) => (
            <option key={i} value={i}>
              {i} · {n}
            </option>
          ))}
        </select>
      )}

      {value.b === "bt" && (
        <select aria-label={t("Bluetooth command", "블루투스 명령")} value={value.cmd} onChange={(e) => onChange({ ...value, cmd: e.target.value })}>
          {(BT_CMDS.includes(value.cmd) ? BT_CMDS : [value.cmd, ...BT_CMDS]).map((c) => (
            <option key={c} value={c}>
              {btLabel(c)}
            </option>
          ))}
        </select>
      )}

      {value.b === "out" && (
        <select aria-label={t("Output", "출력")} value={value.cmd} onChange={(e) => onChange({ ...value, cmd: e.target.value })}>
          {OUT_CMDS.map((c) => (
            <option key={c} value={c}>
              {outLabel(c)}
            </option>
          ))}
        </select>
      )}

      {value.b === "ref" && (
        <select aria-label={t("Macro or tap dance", "매크로 또는 탭댄스")} value={value.id} onChange={(e) => onChange({ ...value, id: e.target.value })}>
          {!refs.some((r) => r.id === value.id) && <option value={value.id}>{t("Missing", "없음")}</option>}
          {refs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.kind}: {r.name}
            </option>
          ))}
        </select>
      )}

      {value.b === "raw" && (
        <input
          type="text"
          aria-label={t("ZMK binding", "ZMK 바인딩")}
          spellCheck={false}
          className="ry-mono"
          value={value.text}
          placeholder="&mt LSHFT A"
          onChange={(e) => onChange({ ...value, text: e.target.value })}
        />
      )}
    </div>
  );
};

const ModToggles = ({ value, onChange }: { value: Mod[]; onChange: (m: Mod[]) => void }) => (
  <div className="ry-mods" role="group" aria-label={t("Modifiers", "보조키")}>
    {(["LC", "LS", "LA", "LG"] as Mod[]).map((m) => {
      const on = value.includes(m);
      return (
        <button
          key={m}
          type="button"
          className="ry-chip"
          aria-pressed={on}
          onClick={() => onChange(on ? value.filter((x) => x !== m) : [...value, m])}
        >
          {MOD_LABEL[m]}
        </button>
      );
    })}
  </div>
);

/** Searchable key list: type “a”, “enter”, “vol”, “hangul”… */
export const KeyPicker = ({ value, onChange }: { value: string; onChange: (k: string) => void }) => {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return COMMON.map((id) => KEYCODES.find((k) => k.id === id)).filter(Boolean) as KC[];
    const score = (k: KC) => {
      const names = [k.id, ...k.n].map((x) => x.toLowerCase());
      if (names.includes(s)) return 0;
      if (names.some((x) => x.startsWith(s))) return 1;
      if (k.d.toLowerCase().includes(s)) return 2;
      if (names.some((x) => x.includes(s))) return 3;
      return 9;
    };
    return KEYCODES.map((k) => [score(k), k] as const)
      .filter(([s]) => s < 9)
      .sort((a, b) => a[0] - b[0])
      .slice(0, 60)
      .map(([, k]) => k);
  }, [q]);

  const pick = (k: KC) => {
    onChange(k.id);
    setQ("");
    setOpen(false);
  };
  const current = KEYCODES.find((k) => k.id === value);

  return (
    <div className="ry-keypick" ref={box}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-label={t("Key", "키")}
        spellCheck={false}
        placeholder={value ? `${value}` : t("Search keys", "키 검색")}
        value={open ? q : value ? `${value}${current ? ` — ${current.d}` : ""}` : ""}
        onFocus={() => {
          setOpen(true);
          setHi(0);
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setHi(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, list.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && list[hi]) {
            e.preventDefault();
            pick(list[hi]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && (
        <ul className="ry-keylist" role="listbox">
          {list.length === 0 && <li className="ry-faint">{t("No matching key", "맞는 키가 없어요")}</li>}
          {list.map((k, i) => (
            <li
              key={k.id}
              role="option"
              aria-selected={i === hi}
              onMouseEnter={() => setHi(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(k);
              }}
            >
              <span className="ry-mono">{k.id}</span>
              <span className="ry-faint">{k.d}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
