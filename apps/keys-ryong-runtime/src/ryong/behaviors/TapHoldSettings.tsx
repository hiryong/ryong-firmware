// Tap·Hold timing in plain words (keysbeta). ZMK keeps separate options for Mod-Tap and Layer-Tap,
// but for a person they are the same thing: "how long is a hold". One set of choices, written to
// both. Others (VIA/Vial, Keychron Launcher, Wooting) do the same: one tapping term, presets first.
import { useState } from "react";
import type { BehaviorDoc, Setting } from "./model";
import { SETTING_SPECS } from "./model";
import { BehaviorLab } from "./BehaviorLab";
import { t } from "../i18n";

const KINDS = ["mt", "lt"] as const;
const TERMS = [
  { ms: 150, label: () => t("Quick", "빠르게"), hint: () => t("Fast typists", "빠르게 치는 분") },
  { ms: 200, label: () => t("Normal", "보통"), hint: () => t("Recommended", "추천") },
  { ms: 280, label: () => t("Relaxed", "여유 있게"), hint: () => t("Fewer accidental holds", "실수로 홀드되는 일이 적어요") },
];
const FLAVOR_CHOICES = [
  { v: "balanced", label: () => t("Balanced (recommended)", "균형 (추천)"),
    hint: () => t("While holding, press and release another key → hold. Otherwise time decides.", "누른 채로 다른 키를 눌렀다 떼면 홀드. 아니면 시간으로 판단해요.") },
  { v: "hold-preferred", label: () => t("Hold right away", "바로 홀드"),
    hint: () => t("While holding, any other key press → hold. Snappy shortcuts, more accidental holds while typing fast.", "누른 채로 다른 키를 누르는 순간 홀드. 단축키가 빠르지만, 빠른 타이핑 중 실수가 생길 수 있어요.") },
  { v: "tap-preferred", label: () => t("Time only", "시간으로만"),
    hint: () => t("Only holding past the time counts as hold. Safest while typing.", "정해진 시간을 넘겨 누르고 있어야만 홀드. 타이핑 중 실수가 가장 적어요.") },
  { v: "tap-unless-interrupted", label: () => t("Only with another key", "다른 키와 함께일 때만"),
    hint: () => t("Hold only when another key is pressed meanwhile (home-row modifiers).", "누르는 동안 다른 키를 함께 누를 때만 홀드 (홈로우 수정키용).") },
];

type Props = Record<string, number | string>;
const def = (p: string) => SETTING_SPECS.mt.props[p]?.def;

export function TapHoldSettings({ doc, setDoc }: { doc: BehaviorDoc; setDoc: React.Dispatch<React.SetStateAction<BehaviorDoc>> }) {
  const present = KINDS.filter((k) => (doc.settings ?? []).some((s) => s.behavior === k));
  const props = (k: string): Props => (doc.settings ?? []).find((s) => s.behavior === k)?.props ?? {};
  const val = (k: string, p: string) => props(k)[p] ?? def(p);
  const lead = present[0] ?? "mt";
  const term = Number(val(lead, "tapping-term-ms"));
  const flavor = String(val(lead, "flavor"));
  const quick = Number(val(lead, "quick-tap-ms"));
  const idle = Number(val(lead, "require-prior-idle-ms"));
  const differs = present.length > 1 && ["tapping-term-ms", "flavor", "quick-tap-ms", "require-prior-idle-ms"].some((p) => String(val("mt", p)) !== String(val("lt", p)));
  const [customPicked, setCustom] = useState(false);
  const custom = customPicked || !TERMS.some((x) => x.ms === term); // device values like 230 show as custom
  const [draft, setDraft] = useState<string | null>(null); // typed text, applied on blur / Enter

  /** Same values for Mod-Tap and Layer-Tap: the first change makes them identical (what is shown). */
  const set = (p: string, v: number | string) => setDoc((d) => {
    const list: Setting[] = [...(d.settings ?? [])];
    const base = list.find((s) => s.behavior === lead)?.props ?? {};
    for (const k of present) {
      const i = list.findIndex((s) => s.behavior === k);
      if (i >= 0) list[i] = { behavior: k, props: { ...base, [p]: v } };
    }
    return { ...d, settings: list };
  });
  const unify = () => setDoc((d) => {
    const base = (d.settings ?? []).find((s) => s.behavior === lead)?.props ?? {};
    return { ...d, settings: (d.settings ?? []).map((s) => (KINDS as readonly string[]).includes(s.behavior) ? { ...s, props: { ...base } } : s) };
  });

  if (!present.length) return <p className="ry-faint">{t("This firmware has no adjustable tap·hold keys.", "이 펌웨어에는 조절할 수 있는 탭·홀드 키가 없어요.")}</p>;
  return <div className="ry-taphold">
    <section className="ry-card ry-setcard">
      <h3 className="ry-h2">{t("How long is a hold?", "얼마나 누르면 홀드일까요?")}</h3>
      <p className="ry-faint">{t("A tap·hold key types its key when tapped, and acts as a modifier or a layer when held. This applies to every such key.",
        "탭·홀드 키는 짧게 누르면 입력, 길게 누르면 수정키나 레이어로 동작해요. 모든 탭·홀드 키에 함께 적용돼요.")}</p>
      <div className="ry-chips" role="group" aria-label={t("Hold time", "홀드 판단 시간")}>
        {TERMS.map((x) => <button key={x.ms} className="ry-chip" aria-pressed={!custom && term === x.ms} title={x.hint()}
          onClick={() => { setCustom(false); set("tapping-term-ms", x.ms); }}>{x.label()} <span className="ry-faint">{x.ms}ms</span></button>)}
        <button className="ry-chip" aria-pressed={custom} onClick={() => setCustom(true)}>{t("Custom", "직접")}</button>
      </div>
      {custom && <label className="ry-inline">
        <input type="number" className="ry-num" min={50} max={2000} value={draft ?? String(term)} aria-label={t("Hold time (ms)", "홀드 판단 시간 (ms)")}
          onChange={(e) => { const v = e.target.value; const n = Number(v); setDraft(v); if (v.trim() && Number.isInteger(n) && n >= 50 && n <= 2000) set("tapping-term-ms", n); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          onBlur={() => { if (draft !== null) { const n = Number(draft); if (draft.trim() && Number.isFinite(n)) set("tapping-term-ms", Math.max(50, Math.min(2000, Math.round(n)))); setDraft(null); } }} /> ms</label>}
    </section>

    <section className="ry-card ry-setcard">
      <h3 className="ry-h2">{t("When you press another key while holding", "누른 채로 다른 키를 누르면")}</h3>
      <div className="ry-choices" role="radiogroup" aria-label={t("Decision", "판단 방식")}>
        {FLAVOR_CHOICES.map((f) => <label key={f.v} className={"ry-choice" + (flavor === f.v ? " is-on" : "")}>
          <input type="radio" name="ry-flavor" checked={flavor === f.v} onChange={() => set("flavor", f.v)} />
          <span><strong>{f.label()}</strong><span className="ry-faint">{f.hint()}</span></span>
        </label>)}
      </div>
    </section>

    <details className="ry-card ry-setcard">
      <summary>{t("More options", "추가 옵션")}</summary>
      <label className="ry-choice">
        <input type="checkbox" checked={quick > 0} onChange={(e) => set("quick-tap-ms", e.target.checked ? 175 : 0)} />
        <span><strong>{t("Tap then hold repeats the key", "두 번째 누르고 있으면 키 반복")}</strong>
          <span className="ry-faint">{t("Tap, then press and hold quickly: the tap key repeats (e.g. holding Space) instead of holding.", "한 번 탭한 뒤 바로 다시 누르고 있으면 홀드 대신 그 키가 반복돼요 (예: 스페이스 길게).")}</span></span>
      </label>
      <label className="ry-choice">
        <input type="checkbox" checked={idle > 0} onChange={(e) => set("require-prior-idle-ms", e.target.checked ? 150 : 0)} />
        <span><strong>{t("While typing fast, always tap", "빠르게 타이핑하는 중엔 항상 입력")}</strong>
          <span className="ry-faint">{t("Pressed right after another key → always a tap. Prevents accidental modifiers mid-word.", "다른 키 직후에 누르면 항상 짧게 누름으로 처리해요. 단어 중간에 수정키가 잘못 걸리는 걸 막아요.")}</span></span>
      </label>
    </details>

    {differs && <p className="ry-faint">{t("Modifier and layer tap·hold keys came with slightly different values. Any change here makes them the same.", "수정키용·레이어용 탭·홀드 키가 조금 다른 값으로 들어 있어요. 여기서 하나라도 바꾸면 둘이 같아져요.")}
      {" "}<button className="ry-text" onClick={unify}>{t("Make them the same now", "지금 같게 맞추기")}</button></p>}

    <section className="ry-card ry-setcard">
      <h3 className="ry-h2">{t("Try it", "직접 해보기")}</h3>
      <BehaviorLab lab={{ kind: "holdTap", term, quickTap: quick, flavor, tapLabel: "F", holdLabel: "Shift" }} />
    </section>
  </div>;
}
