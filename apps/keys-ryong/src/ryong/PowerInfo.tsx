import { useEffect, useState } from "react";
import { readFile } from "./api";
import type { Board } from "./keyboards";
import { dirOf } from "./behaviors/keymapFile";
import { LAYOUTS } from "./behaviors/layouts";
import { Power } from "lucide-react";
import { At, KeyLabel, PowerDoc, PowerKeys, powerFromKeymap, readPower } from "./power";
import { t } from "./i18n";

export interface PowerState {
  keys: PowerKeys | null;
  power: PowerDoc | null;
  /** Soft Off hold time, from the site's Settings (ryong-behaviors.json) */
  holdMs?: number;
  /** where Soft Off was found: on the connected keyboard (editor changes included) or in the firmware's keymap */
  from: "keyboard" | "file";
  keymap: string | null;
}

export function usePower(b: Board, liveAt: At[] | null): PowerState | null {
  const [base, setBase] = useState<{ keymap: string | null; power: PowerDoc | null; holdMs?: number } | null>(null);
  useEffect(() => {
    let ignore = false;
    Promise.all([
      readFile(b.repo, b.branch, b.keymap).catch(() => null),
      readPower(b),
      readFile(b.repo, b.branch, `${dirOf(b.keymap)}ryong-behaviors.json`).catch(() => null),
    ]).then(([keymap, power, beh]) => {
      if (ignore) return;
      let holdMs: number | undefined;
      try {
        const v = beh ? JSON.parse(beh).settings?.find((s: { behavior: string }) => s.behavior === "soft_off")?.props?.["hold-time-ms"] : undefined;
        if (typeof v === "number") holdMs = v;
      } catch {
        /* unreadable */
      }
      // a Soft Off setting still written in the keymap itself
      if (holdMs === undefined && keymap) {
        const m = keymap.match(/&soft_off\s*\{[^}]*hold-time-ms\s*=\s*<\s*(\d+)\s*>/);
        if (m) holdMs = Number(m[1]);
      }
      setBase({ keymap, power, holdMs });
    });
    return () => {
      ignore = true;
    };
  }, [b.repo, b.branch, b.keymap]);
  if (!base) return null;
  const keys = base.keymap ? powerFromKeymap(base.keymap, liveAt ?? undefined, base.power?.wake) : null;
  return { keys, power: base.power, holdMs: base.holdMs, from: liveAt ? "keyboard" : "file", keymap: base.keymap };
}

const secs = (ms?: number) => (ms ? (ms % 1000 ? (ms / 1000).toFixed(1) : String(ms / 1000)) : null);

/** "Power — off Fn + Left Ctrl (3 s) · on Fn + Left Ctrl (3 s)" on a keyboard card. */
export const PowerLine = ({ b, liveSoftOff }: { b: Board; liveSoftOff: At[] | null }) => {
  const p = usePower(b, liveSoftOff);
  if (!p?.keys && !b.powerKey) return null;
  const k = p?.keys;
  const hold = secs(p?.holdMs);
  const onKeys = k && k.wake ? [k.wake, k.off[k.off.length - 1]].filter((x, i, a) => a.indexOf(x) === i) : null;
  return (
    <div className="ry-faint">
      {t("Power", "전원")}{" "}
      {k && (
        <>
          {t("off", "끄기")} <span className="ry-code">{k.off.join(" + ")}</span>
          {hold && ` (${t("{s} s", "{s}초", { s: hold })})`}
          {onKeys && (
            <>
              {" · "}
              {t("on", "켜기")} <span className="ry-code">{onKeys.join(" + ")}</span> ({t("{s} s", "{s}초", { s: 3 })})
            </>
          )}
          <span title={p?.from === "keyboard" ? t("Read from the connected keyboard", "연결된 키보드에서 읽음") : t("From the firmware's keymap; editor changes show when the keyboard is connected", "펌웨어 키맵 기준이에요. 편집기에서 바꾼 건 키보드를 연결하면 반영돼요")}>
            {p?.from === "keyboard" ? t(" · from the keyboard", " · 키보드 기준") : ""}
          </span>
        </>
      )}
      {b.powerKey && <> {k ? "· " : ""}{b.powerKey}</>}
    </div>
  );
};

/**
 * Pick the key that wakes the keyboard after a Soft Off (keyboards with ryong-power.json).
 * Waking is wiring (a key position), not what the key does, so each key shows what it does now and the
 * picked one carries a power mark; the Soft Off key gets an orange mark.
 */
export const WakePicker = ({
  b,
  power,
  labels,
  fromKeyboard,
  offAt,
  offWith,
  value,
  onChange,
}: {
  b: Board;
  power: PowerDoc;
  labels: KeyLabel[];
  fromKeyboard: boolean;
  offAt: number[];
  offWith: string | null;
  value: number;
  onChange: (pos: number) => void;
}) => {
  const keys = LAYOUTS[b.layout || "60-ansi"] ?? LAYOUTS["60-ansi"];
  const usable = keys.slice(0, power.positions.length);
  const w = Math.max(...usable.map(([x, , kw]) => x + kw), 100);
  const h = Math.max(...usable.map(([, y, , kh]) => y + kh), 100);
  const label = (i: number): KeyLabel => labels[i] ?? { main: usable[i]?.[4] ?? `#${i + 1}` };
  const wake = label(value);
  const offKey = offAt.length ? label(offAt[0]).main : null;
  return (
    <div className="ry-field">
      <span className="ry-label">{t("Wake key", "깨우기 키")}</span>
      <div className="ry-combokeys ry-wakekeys" style={{ aspectRatio: `${w} / ${h}` }}>
        {usable.map(([x, y, kw, kh], i) => {
          const l = label(i);
          const off = offAt.includes(i);
          return (
            <button
              key={i}
              type="button"
              aria-pressed={i === value}
              aria-label={`${l.main}${l.sub ? ` (${l.sub})` : ""}${i === value ? ` — ${t("wake key", "깨우기 키")}` : ""}`}
              title={l.sub ? `${l.main} — ${l.sub}` : l.main}
              style={{ left: `${(x / w) * 100}%`, top: `${(y / h) * 100}%`, width: `${(kw / w) * 100}%`, height: `${(kh / h) * 100}%` }}
              onClick={() => onChange(i)}
            >
              <span>
                {i === value && <Power className="ry-wake-mark" aria-hidden="true" />}
                {off && <i className="ry-off-mark" aria-hidden="true" />}
                <b>{l.main}</b>
                {l.sub && <small>{l.sub}</small>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="ry-wake-legend">
        <span>
          <Power className="ry-legend-icon" aria-hidden="true" />
          {t("Wake: {k}", "깨우기: {k}", { k: wake.main })}
          {wake.sub && <span className="ry-faint">&nbsp;({wake.sub})</span>}
        </span>
        {offKey && (
          <span>
            <i className="ry-off-mark is-inline" aria-hidden="true" />
            {t("Soft Off: {k}", "끄기: {k}", { k: offWith ? `${offWith} + ${offKey}` : offKey })}
          </span>
        )}
      </div>
      <span className="ry-faint">
        {t(
          "After Soft Off, only this key wakes the keyboard. It works by position, so it still wakes even if you change what the key does. Pick one you won't hit by accident.",
          "전원을 끈 뒤에는 이 자리의 키로만 깨울 수 있어요. 키 위치로 동작해서, 편집기에서 키 기능을 바꿔도 깨우기는 그대로예요. 실수로 누르지 않을 키를 고르세요."
        )}
      </span>
      <span className="ry-faint">
        {fromKeyboard
          ? t("Key labels: the connected keyboard, including changes made in the editor.", "키 이름: 연결된 키보드 기준이에요. 편집기에서 바꾼 것도 반영돼요.")
          : t("Key labels: the firmware's keymap. Connect and unlock the keyboard to see changes made in the editor.", "키 이름: 펌웨어 키맵 기준이에요. 키보드를 연결하고 잠금을 풀면 편집기에서 바꾼 것도 보여요.")}
      </span>
    </div>
  );
};
