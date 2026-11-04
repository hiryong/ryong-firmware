// Tap dance and tap·hold on the connected keyboard, written from scratch around what they are:
//
//  - Tap dance (ZMK &td / runtime tap dance): ONE key, the NUMBER of quick presses picks the action
//    (1, 2 or 3 presses on this firmware). The count is final when no new press comes within the
//    interval, so even a single press waits that long. One interval for every tap dance here.
//  - Tap·hold (ZMK hold-tap: &mt mod-tap, &lt layer-tap): ONE key, HOW LONG it is held picks the role.
//    A short press types the tap key; holding it is a modifier (Ctrl, Shift…) or a layer while held.
//    Tap and hold are both chosen freely. Timing (hold time, what another key press means) is shared.
//
// Both are "what a key does", so the list shows the keys that have one, "+ Add" opens one small
// editor (key → actions → Register), and Register writes it to the keyboard at once.
import { ReactNode, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import type { RpcConnection } from "@zmkfirmware/zmk-studio-ts-client/index";
import type { BehaviorDoc, Binding, TapDance } from "./model";
import { FLAVORS } from "./model";
import type { KeyRect } from "./layouts";
import { KeyPick } from "./KeyPick";
import { FriendlyBindingPicker, friendlyLabel } from "./FriendlyBindingPicker";
import type { RuntimeView } from "../runtime/modelBridge";
import { decode, wireOf } from "../runtime/modelBridge";
import { assignKeys, bindingAt, keysWith, tapUsageAt, wireAt, Wire } from "../runtime/assignKey";
import values from "../runtime/keycode-values.json";
import { t } from "../i18n";

const codes = values as Record<string, number>;

export type KeyFeatureProps = {
  view: RuntimeView; conn?: RpcConnection; doc: BehaviorDoc; layers: string[]; keys: KeyRect[];
  /** saves the dynamic behaviors to the keyboard (throws on failure) */
  commit: (next: BehaviorDoc) => Promise<{ view: RuntimeView; nextDoc: BehaviorDoc }>;
  onView: (view: RuntimeView) => void;
};
type Spot = { layer: number; pos: number };
const same = (a?: Spot, b?: Spot) => !!a && !!b && a.layer === b.layer && a.pos === b.pos;

function useRun() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };
  return { busy, msg, run, clear: () => setMsg(null) };
}

/** Writes keys, then reads the keymap back so every view shows it. */
async function place(p: KeyFeatureProps, view: RuntimeView, writes: (Spot & { wire: Wire })[]) {
  if (!p.conn) throw new Error(t("Connect the keyboard first.", "키보드를 먼저 연결하세요."));
  if (writes.length) await assignKeys(p.conn, view, writes);
  const snapshot = await view.session.refreshKeymap(view.snapshot);
  const next = { ...view, snapshot };
  p.onView(next);
  return next;
}

const layerName = (layers: string[], i: number) => layers[i] || t("Layer {n}", "레이어 {n}", { n: i });
const where = (layers: string[], s: Spot) => s.layer === 0 ? "" : ` · ${layerName(layers, s.layer)}`;
const Cap = ({ children, wide }: { children: ReactNode; wide?: boolean }) => <kbd className={"ry-kx-cap" + (wide ? " is-wide" : "")}>{children}</kbd>;

function Concept({ children }: { children: ReactNode }) {
  return <div className="ry-kx-concept">{children}</div>;
}

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  return <p className={"ry-kx-msg" + (msg && !msg.ok ? " is-bad" : "")} role="status" aria-live="polite">{msg?.text ?? ""}</p>;
}

function ActionBox({ label, empty, open, onClick, name }: { label?: string; empty: string; open: boolean; onClick: () => void; name: string }) {
  return <button type="button" className={"ry-kx-box" + (label ? "" : " is-empty")} aria-expanded={open} aria-label={name} onClick={onClick}>{label ?? empty}</button>;
}

/* ------------------------------------------------------------------ tap dance */

type DanceDraft = { id?: string; from?: Spot; spot?: Spot; acts: (Binding | null)[] };
const danceIndex = (id?: string) => id?.startsWith("runtime_dance_") ? Number(id.slice(14)) : undefined;
const TERMS = [150, 200, 300];

export function TapDancePanel(p: KeyFeatureProps) {
  const { view, doc, layers, keys } = p;
  const rtd = view.catalog.rtd;
  const [draft, setDraft] = useState<DanceDraft | null>(null);
  const [mapLayer, setMapLayer] = useState(0);
  const [pick, setPick] = useState<number | null>(null);
  const { busy, msg, run, clear } = useRun();
  const label = (b: Binding) => friendlyLabel(b, doc, layers);
  const keyName = (s: Spot) => keys[s.pos]?.[4] ?? String(s.pos);
  const spotsOf = (td: TapDance) => { const i = danceIndex(td.id); return i === undefined || rtd === undefined ? [] : keysWith(view, rtd, i); };
  const [shownTerm, setShownTerm] = useState<number | null>(null);
  const term = shownTerm ?? doc.tapDances[0]?.term ?? 200;

  /** What a key does now, as a first-press action (a tap dance or tap·hold gives its own first action). */
  const firstAction = (s: Spot): Binding | null => {
    const w = wireAt(view, s.layer, s.pos);
    if (w && rtd !== undefined && w.behaviorId === rtd) return doc.tapDances.find((d) => danceIndex(d.id) === w.param1)?.bindings[0] ?? null;
    const u = tapUsageAt(view, s.layer, s.pos);
    if (u !== undefined && w?.behaviorId !== view.catalog.kp) { try { return decode({ behaviorId: view.catalog.kp!, param1: u, param2: 0 }, view); } catch { return null; } }
    return bindingAt(view, s.layer, s.pos) ?? null;
  };
  const choose = (pos: number) => {
    const s = { layer: mapLayer, pos };
    const w = wireAt(view, s.layer, s.pos);
    const there = w && rtd !== undefined && w.behaviorId === rtd ? doc.tapDances.find((d) => danceIndex(d.id) === w.param1) : undefined;
    clear(); setPick(null);
    if (there && there.id !== draft?.id) { setDraft({ id: there.id, from: s, spot: s, acts: [...there.bindings] }); return; }
    setDraft((d) => ({ ...(d ?? { acts: [null, null] }), spot: s, acts: [firstAction(s), ...(d?.acts.slice(1) ?? [null])] }));
  };
  const startNew = () => { clear(); setPick(null); setMapLayer(0); setDraft({ acts: [null, null] }); };
  const startEdit = (td: TapDance) => {
    const s = spotsOf(td)[0];
    clear(); setPick(null); setMapLayer(s?.layer ?? 0);
    setDraft({ id: td.id, from: s, spot: s, acts: [...td.bindings] });
  };
  const ready = !!draft?.spot && draft.acts.length >= 2 && draft.acts.every(Boolean);

  const register = () => run(async () => {
    if (!draft?.spot || !ready || rtd === undefined) throw new Error(t("Choose the key and every action.", "키와 동작을 모두 고르세요."));
    const acts = draft.acts as Binding[], spot = draft.spot, name = `TD ${keyName(spot)}`.slice(0, 16);
    const before = new Set(doc.tapDances.map((x) => x.id));
    const next: BehaviorDoc = draft.id
      ? { ...doc, tapDances: doc.tapDances.map((x) => (x.id === draft.id ? { ...x, name, bindings: acts } : x)) }
      : { ...doc, tapDances: [...doc.tapDances, { id: "new_td_" + Date.now(), name, term, bindings: acts }] };
    const r = await p.commit(next);
    const id = draft.id ?? r.nextDoc.tapDances.find((x) => !before.has(x.id))?.id;
    const index = danceIndex(id);
    if (index === undefined) throw new Error(t("The keyboard did not keep the tap dance.", "키보드가 탭댄스를 저장하지 못했어요."));
    const writes: (Spot & { wire: Wire })[] = [{ ...spot, wire: { behaviorId: rtd, param1: index, param2: 0 } }];
    if (draft.from && !same(draft.from, spot)) writes.push({ ...draft.from, wire: wireOf(acts[0], r.view, r.nextDoc) });
    await place(p, r.view, writes);
    setDraft(null);
    return t("Registered on {k}. Try it on the keyboard now.", "{k} 키에 등록했어요. 키보드에서 바로 눌러 보세요.", { k: keyName(spot) });
  });
  const removeDance = (td: TapDance) => {
    const on = spotsOf(td);
    const back = td.bindings[0] ? label(td.bindings[0]) : "";
    if (!confirm(on.length ? t("Remove this tap dance? The key goes back to {b}.", "이 탭댄스를 지울까요? 키는 1번 누름 동작({b})으로 돌아가요.", { b: back }) : t("Remove this tap dance?", "이 탭댄스를 지울까요?"))) return;
    void run(async () => {
      if (on.length) await place(p, view, on.map((s) => ({ ...s, wire: wireOf(td.bindings[0], view, doc) })));
      await p.commit({ ...doc, tapDances: doc.tapDances.filter((x) => x.id !== td.id) });
      if (draft?.id === td.id) setDraft(null);
      return t("Removed.", "지웠어요.");
    });
  };
  const setTerm = (ms: number) => { setShownTerm(ms); return run(async () => {
    try { await p.commit({ ...doc, tapDances: doc.tapDances.map((x) => ({ ...x, term: ms })) }); } finally { setShownTerm(null); }
    return t("Interval saved: {n} ms.", "간격을 {n}ms로 저장했어요.", { n: ms });
  }); };

  if (rtd === undefined) return <p className="ry-note">{t("This firmware has no tap dance.", "이 펌웨어에는 탭댄스가 없어요.")}</p>;
  const k = draft?.spot ? keyName(draft.spot) : "Q";
  return <div className="ry-kx">
    <Concept>
      <p><strong>{t("Tap dance", "탭댄스")}</strong> {t("— one key, and how many times you press it in a row picks what it does.", "— 키 하나를 연달아 몇 번 눌렀는지에 따라 다른 동작을 해요.")}</p>
      <div className="ry-kx-demo" aria-hidden="true">
        <span><Cap>Q</Cap><i>→</i><b>Q</b></span>
        <span><Cap>Q</Cap><Cap>Q</Cap><i>→</i><b>Esc</b></span>
        <span><Cap>Q</Cap><Cap>Q</Cap><Cap>Q</Cap><i>→</i><b>Caps Lock</b></span>
      </div>
      <p className="ry-faint">{t("The count is final once you stop for {n} ms, so even one press comes {n} ms late. Best on keys you don't type in fast runs (Esc, F-keys, punctuation).",
        "{n}ms 동안 더 누르지 않으면 횟수가 확정돼요. 그래서 한 번 누름도 {n}ms 늦게 입력돼요. 빠르게 연타하는 글자보다 Esc·기능키·기호 키에 어울려요.", { n: term })}</p>
    </Concept>

    <section className="ry-kx-sec" aria-label={t("Registered tap dances", "등록된 탭댄스")}>
      <h3 className="ry-kx-h">{t("Registered", "등록된 탭댄스")} <span className="ry-count">{doc.tapDances.length}</span></h3>
      {doc.tapDances.length === 0 && <p className="ry-faint">{t("None yet.", "아직 없어요.")}</p>}
      <ul className="ry-kx-list">
        {doc.tapDances.map((td) => {
          const on = spotsOf(td);
          return <li key={td.id} className={"ry-kx-row" + (draft?.id === td.id ? " is-edit" : "")}>
            <Cap wide>{on[0] ? keyName(on[0]) : "?"}</Cap>
            <div className="ry-kx-what">
              {td.bindings.map((b, i) => <span key={i}><em>{t("{n}×", "{n}번", { n: i + 1 })}</em>{label(b)}</span>)}
              <small className="ry-faint">{on.length ? (on[0].layer ? layerName(layers, on[0].layer) : t("Base layer", "기본 레이어")) + (on.length > 1 ? t(" +{n} keys", " 외 {n}개 키", { n: on.length - 1 }) : "") : t("Not on a key", "키에 없음")}</small>
            </div>
            <button type="button" className="ry-icon" disabled={busy} aria-label={t("Edit {k}", "{k} 편집", { k: on[0] ? keyName(on[0]) : td.name })} onClick={() => startEdit(td)}><Pencil /></button>
            <button type="button" className="ry-icon" disabled={busy} aria-label={t("Remove {k}", "{k} 지우기", { k: on[0] ? keyName(on[0]) : td.name })} onClick={() => removeDance(td)}><Trash2 /></button>
          </li>;
        })}
      </ul>
      {!draft && <button type="button" className="ry-ghost ry-add" disabled={busy} onClick={startNew}><Plus /> {t("Add a tap dance", "탭댄스 추가")}</button>}
      {!draft && <Msg msg={msg} />}
    </section>

    {draft && <section className="ry-kx-editor" aria-label={draft.id ? t("Edit tap dance", "탭댄스 편집") : t("New tap dance", "새 탭댄스")}>
      <div className="ry-kx-edhead">
        <h3 className="ry-kx-h">{draft.id ? t("Edit tap dance", "탭댄스 편집") : t("New tap dance", "새 탭댄스")}</h3>
        <button type="button" className="ry-icon" aria-label={t("Close", "닫기")} onClick={() => setDraft(null)}><X /></button>
      </div>
      <div className="ry-kx-step"><span className="ry-kx-num">1</span><b>{t("Which key?", "어느 키에?")}</b>
        <span className="ry-faint">{draft.spot ? `${keyName(draft.spot)}${where(layers, draft.spot)}` : t("Click it on the map.", "아래 키보드에서 누르세요.")}</span></div>
      <KeyPick keys={keys} layers={layers} layer={mapLayer} pos={draft.spot?.layer === mapLayer ? draft.spot.pos : undefined}
        labelAt={(l, pos) => { const b = bindingAt(view, l, pos); return b ? label(b) : undefined; }} onLayer={setMapLayer} onPick={choose} />
      <div className="ry-kx-step"><span className="ry-kx-num">2</span><b>{t("What each count does", "누른 횟수마다 할 동작")}</b></div>
      <div className="ry-kx-lines">
        {draft.acts.map((b, i) => <div key={i} className="ry-kx-line">
          <span className="ry-kx-taps" aria-hidden="true">{Array.from({ length: i + 1 }, (_, j) => <Cap key={j}>{k}</Cap>)}</span>
          <span className="ry-kx-say">{t("{n}×", "{n}번 누르면", { n: i + 1 })}</span>
          <ActionBox label={b ? label(b) : undefined} empty={t("Choose", "고르기")} open={pick === i} onClick={() => setPick(pick === i ? null : i)}
            name={t("What {n} presses do", "{n}번 누르면 할 동작", { n: i + 1 })} />
          {i === 2 && <button type="button" className="ry-icon" aria-label={t("Remove 3 presses", "3번 누름 빼기")} onClick={() => { setPick(null); setDraft({ ...draft, acts: draft.acts.slice(0, 2) }); }}><Trash2 /></button>}
          {pick === i && <div className="ry-kx-pick">
            <FriendlyBindingPicker value={b ?? { b: "none" }} doc={doc} layerNames={layers} exclude={draft.id}
              onChange={(nb) => { setDraft({ ...draft, acts: draft.acts.map((x, j) => (j === i ? nb : x)) }); setPick(null); }} />
          </div>}
        </div>)}
        {draft.acts.length < 3 && <button type="button" className="ry-text" onClick={() => setDraft({ ...draft, acts: [...draft.acts, null] })}>{t("+ 3 presses", "+ 3번 누름 추가")}</button>}
      </div>
      {i18nHint(draft.spot ? t("1× starts as what {k} did, so the key still works as before with a single press.", "1번 누름은 {k} 키가 원래 하던 동작으로 채워져요. 한 번 누르면 예전처럼 동작해요.", { k: keyName(draft.spot) }) : "")}
      <div className="ry-kx-foot">
        <Msg msg={msg} />
        <button type="button" className="ry-outline" disabled={busy} onClick={() => setDraft(null)}>{t("Cancel", "취소")}</button>
        <button type="button" className="ry-primary" disabled={busy || !ready || !p.conn} onClick={() => void register()}>{busy ? t("Saving…", "저장 중…") : t("Register on the key", "키에 등록")}</button>
      </div>
    </section>}

    {doc.tapDances.length > 0 && <section className="ry-kx-sec" aria-label={t("Interval", "연타 간격")}>
      <h3 className="ry-kx-h">{t("How fast the presses must follow", "연타로 인정하는 간격")}</h3>
      <div className="ry-chips" role="group" aria-label={t("Interval", "연타 간격")}>
        {TERMS.map((ms) => <button key={ms} type="button" className="ry-chip" disabled={busy} aria-pressed={term === ms} onClick={() => void setTerm(ms)}>
          {ms === 150 ? t("Quick", "빠르게") : ms === 200 ? t("Normal", "보통") : t("Relaxed", "여유 있게")} <span className="ry-faint">{ms}ms</span></button>)}
        {!TERMS.includes(term) && <span className="ry-chip" aria-pressed="true">{term}ms</span>}
      </div>
      <p className="ry-faint">{t("Shorter: a single press comes sooner, but you must tap faster. Applies to every tap dance.", "짧을수록 한 번 누름이 빨리 입력되지만 더 빠르게 연타해야 해요. 모든 탭댄스에 같이 적용돼요.")}</p>
    </section>}
  </div>;
}
const i18nHint = (text: string) => text ? <p className="ry-faint">{text}</p> : null;

/* ------------------------------------------------------------------ tap·hold */

const MODS: [string, string][] = [["Ctrl", "LCTRL"], ["Shift", "LSHFT"], ["Alt (⌥)", "LALT"], ["Win (⌘)", "LGUI"]];
type HoldDraft = { from?: Spot; spot?: Spot; tap: Binding | null; hold: string | null };
const HOLD_TERMS = [
  { ms: 150, label: () => t("Quick", "빠르게") },
  { ms: 200, label: () => t("Normal", "보통") },
  { ms: 280, label: () => t("Relaxed", "여유 있게") },
];
const FLAVOR_TEXT: Record<string, [() => string, () => string]> = {
  balanced: [() => t("Balanced (recommended)", "균형 (추천)"), () => t("Hold it, press AND release another key → hold. Typing fast over it stays a tap.", "누른 채 다른 키를 눌렀다 떼면 '길게'. 빠르게 지나치며 친 건 '짧게'로 남아요.")],
  "hold-preferred": [() => t("Right away", "바로"), () => t("Hold it and press any other key → hold at once. Snappy shortcuts; more slips when typing fast.", "누른 채 다른 키를 누르는 순간 '길게'. 단축키가 빠르지만 빠른 타이핑 중 실수가 생길 수 있어요.")],
  "tap-preferred": [() => t("Time only", "시간으로만"), () => t("Only holding past the hold time counts. Fewest slips while typing.", "판정 시간을 넘겨 누르고 있어야만 '길게'. 타이핑 실수가 가장 적어요.")],
  "tap-unless-interrupted": [() => t("Only with another key", "다른 키와 함께일 때만"), () => t("Hold only if another key is pressed meanwhile; the time doesn't matter.", "누르는 동안 다른 키를 누를 때만 '길게'. 시간은 상관없어요.")],
};

export function TapHoldPanel(p: KeyFeatureProps) {
  const { view, doc, layers, keys } = p;
  const { kp, mt, lt } = view.catalog;
  const [draft, setDraft] = useState<HoldDraft | null>(null);
  const [mapLayer, setMapLayer] = useState(0);
  const [pickTap, setPickTap] = useState(false);
  const { busy, msg, run, clear } = useRun();
  const label = (b: Binding) => friendlyLabel(b, doc, layers);
  const usageLabel = (u: number) => { try { return label(decode({ behaviorId: kp!, param1: u, param2: 0 }, view)); } catch { return "?"; } };
  const holdLabel = (h: string) => h.startsWith("l") ? t("{l} layer", "{l} 레이어", { l: layerName(layers, Number(h.slice(1))) })
    : MODS.find(([, k]) => "m" + codes[k] === h)?.[0] ?? usageLabel(Number(h.slice(1)));

  // the registered tap·holds: every Mod-Tap / Layer-Tap key in the keymap
  const items: { spot: Spot; hold: string; tap: number }[] = [];
  view.snapshot.keymap?.layers.forEach((l, layer) => l.bindings.forEach((b, pos) => {
    if (mt !== undefined && b.behaviorId === mt) items.push({ spot: { layer, pos }, hold: "m" + b.param1, tap: b.param2 });
    else if (lt !== undefined && b.behaviorId === lt) items.push({ spot: { layer, pos }, hold: "l" + b.param1, tap: b.param2 });
  }));

  const tapOf = (s: Spot): Binding | null => {
    const u = tapUsageAt(view, s.layer, s.pos);
    if (u === undefined) return null;
    try { return decode({ behaviorId: kp!, param1: u, param2: 0 }, view); } catch { return null; }
  };
  const choose = (pos: number) => {
    const s = { layer: mapLayer, pos };
    const hit = items.find((x) => same(x.spot, s));
    clear(); setPickTap(false);
    if (hit && !same(hit.spot, draft?.from)) { setDraft({ from: s, spot: s, tap: tapOf(s), hold: hit.hold }); return; }
    setDraft((d) => ({ ...(d ?? { hold: "m" + codes.LCTRL }), spot: s, tap: tapOf(s) ?? d?.tap ?? null, hold: d?.hold ?? "m" + codes.LCTRL }));
  };
  const startNew = () => { clear(); setPickTap(false); setMapLayer(0); setDraft({ tap: null, hold: "m" + codes.LCTRL }); };
  const startEdit = (it: { spot: Spot; hold: string }) => { clear(); setPickTap(false); setMapLayer(it.spot.layer); setDraft({ from: it.spot, spot: it.spot, tap: tapOf(it.spot), hold: it.hold }); };
  const ready = !!draft?.spot && draft.tap?.b === "kp" && !!draft.hold;
  const keyName = (s: Spot) => { const tp = tapOf(s); return tp ? label(tp) : keys[s.pos]?.[4] ?? String(s.pos); };

  const register = () => run(async () => {
    if (!draft?.spot || !draft.tap || !draft.hold || kp === undefined) throw new Error(t("Choose the key and both actions.", "키와 두 동작을 모두 고르세요."));
    const tapUsage = wireOf(draft.tap, view, doc).param1;
    const isLayer = draft.hold.startsWith("l"), v = Number(draft.hold.slice(1));
    const id = isLayer ? lt : mt;
    if (id === undefined) throw new Error(t("This firmware cannot do that hold.", "이 펌웨어는 그 '길게' 동작을 지원하지 않아요."));
    const writes: (Spot & { wire: Wire })[] = [{ ...draft.spot, wire: { behaviorId: id, param1: v, param2: tapUsage } }];
    if (draft.from && !same(draft.from, draft.spot)) {
      const u = tapUsageAt(view, draft.from.layer, draft.from.pos);
      if (u !== undefined) writes.push({ ...draft.from, wire: { behaviorId: kp, param1: u, param2: 0 } });
    }
    await place(p, view, writes);
    const name = label(draft.tap);
    setDraft(null);
    return t("Registered: {k} tap = {k}, hold = {h}. Try it on the keyboard now.", "등록했어요: {k} 짧게 = {k}, 길게 = {h}. 키보드에서 바로 눌러 보세요.", { k: name, h: holdLabel(draft.hold) });
  });
  const removeHold = (it: { spot: Spot; tap: number }) => {
    if (!confirm(t("Remove this tap·hold? The key goes back to {k}.", "이 탭·홀드를 지울까요? 키는 {k}(으)로 돌아가요.", { k: usageLabel(it.tap) }))) return;
    void run(async () => {
      await place(p, view, [{ ...it.spot, wire: { behaviorId: kp!, param1: it.tap, param2: 0 } }]);
      if (same(draft?.from, it.spot)) setDraft(null);
      return t("Removed.", "지웠어요.");
    });
  };

  // shared timing: the firmware keeps one set per kind (Mod-Tap, Layer-Tap); shown and saved as one
  const kinds = (doc.settings ?? []).filter((s) => s.behavior === "mt" || s.behavior === "lt");
  const [shown, setShown] = useState<Record<string, number | string>>({}); // what was just clicked, until saved
  const lead = { ...(kinds[0]?.props ?? {}), ...shown };
  const term = Number(lead["tapping-term-ms"] ?? 200), flavor = String(lead.flavor ?? "balanced");
  const quick = Number(lead["quick-tap-ms"] ?? 0), idle = Number(lead["require-prior-idle-ms"] ?? 0);
  const setTiming = (patch: Record<string, number | string>, done: string) => {
    setShown((x) => ({ ...x, ...patch }));
    return run(async () => {
      try { await p.commit({ ...doc, settings: (doc.settings ?? []).map((s) => (s.behavior === "mt" || s.behavior === "lt" ? { ...s, props: { ...lead, ...patch } } : s)) }); }
      finally { setShown({}); }
      return done;
    });
  };
  const [ownTerm, setOwnTerm] = useState<string | null>(null);

  if (kp === undefined || (mt === undefined && lt === undefined)) return <p className="ry-note">{t("This firmware has no tap·hold.", "이 펌웨어에는 탭·홀드가 없어요.")}</p>;
  const k = draft?.tap ? label(draft.tap) : "F";
  const h = draft?.hold ? holdLabel(draft.hold) : "Ctrl";
  return <div className="ry-kx">
    <Concept>
      <p><strong>{t("Tap·hold", "탭·홀드")}</strong> {t("— one key, two roles: a short press types it, holding it works as another key (a modifier or a layer) for as long as you hold.", "— 키 하나에 두 역할. 짧게 누르면 원래 입력, 누르고 있으면 그동안 다른 키(Ctrl 같은 수정키나 레이어)로 동작해요.")}</p>
      <div className="ry-kx-demo" aria-hidden="true">
        <span><Cap>F</Cap><small>{t("tap", "톡")}</small><i>→</i><b>F</b></span>
        <span><Cap>F</Cap><small className="ry-kx-holdbar">{t("hold", "꾹")}</small><i>+</i><Cap>C</Cap><i>→</i><b>Ctrl + C</b></span>
      </div>
      <p className="ry-faint">{t("Unlike a tap dance (how many presses), this is about how long. The short press types when you let go.", "탭댄스가 '몇 번'이라면 이건 '얼마나 오래'예요. 짧게 누른 글자는 손을 뗄 때 입력돼요.")}</p>
    </Concept>

    <section className="ry-kx-sec" aria-label={t("Registered tap·holds", "등록된 탭·홀드")}>
      <h3 className="ry-kx-h">{t("Registered", "등록된 탭·홀드")} <span className="ry-count">{items.length}</span></h3>
      {items.length === 0 && <p className="ry-faint">{t("None yet.", "아직 없어요.")}</p>}
      <ul className="ry-kx-list">
        {items.map((it) => <li key={`${it.spot.layer}:${it.spot.pos}`} className={"ry-kx-row" + (same(draft?.from, it.spot) ? " is-edit" : "")}>
          <Cap wide>{usageLabel(it.tap)}</Cap>
          <div className="ry-kx-what">
            <span><em>{t("tap", "짧게")}</em>{usageLabel(it.tap)}</span>
            <span><em>{t("hold", "길게")}</em>{holdLabel(it.hold)}</span>
            <small className="ry-faint">{it.spot.layer ? layerName(layers, it.spot.layer) : t("Base layer", "기본 레이어")}</small>
          </div>
          <button type="button" className="ry-icon" disabled={busy} aria-label={t("Edit {k}", "{k} 편집", { k: usageLabel(it.tap) })} onClick={() => startEdit(it)}><Pencil /></button>
          <button type="button" className="ry-icon" disabled={busy} aria-label={t("Remove {k}", "{k} 지우기", { k: usageLabel(it.tap) })} onClick={() => removeHold(it)}><Trash2 /></button>
        </li>)}
      </ul>
      {!draft && <button type="button" className="ry-ghost ry-add" disabled={busy} onClick={startNew}><Plus /> {t("Add a tap·hold", "탭·홀드 추가")}</button>}
      {!draft && <Msg msg={msg} />}
    </section>

    {draft && <section className="ry-kx-editor" aria-label={draft.from ? t("Edit tap·hold", "탭·홀드 편집") : t("New tap·hold", "새 탭·홀드")}>
      <div className="ry-kx-edhead">
        <h3 className="ry-kx-h">{draft.from ? t("Edit tap·hold", "탭·홀드 편집") : t("New tap·hold", "새 탭·홀드")}</h3>
        <button type="button" className="ry-icon" aria-label={t("Close", "닫기")} onClick={() => setDraft(null)}><X /></button>
      </div>
      <div className="ry-kx-step"><span className="ry-kx-num">1</span><b>{t("Which key?", "어느 키에?")}</b>
        <span className="ry-faint">{draft.spot ? `${keyName(draft.spot)}${where(layers, draft.spot)}` : t("Click it on the map.", "아래 키보드에서 누르세요.")}</span></div>
      <KeyPick keys={keys} layers={layers} layer={mapLayer} pos={draft.spot?.layer === mapLayer ? draft.spot.pos : undefined}
        labelAt={(l, pos) => { const b = bindingAt(view, l, pos); if (b) return label(b); const u = tapUsageAt(view, l, pos); return u !== undefined ? usageLabel(u) : undefined; }}
        onLayer={setMapLayer} onPick={choose} />
      <div className="ry-kx-step"><span className="ry-kx-num">2</span><b>{t("Short press and hold", "짧게 / 길게")}</b></div>
      <div className="ry-kx-lines">
        <div className="ry-kx-line">
          <span className="ry-kx-taps" aria-hidden="true"><Cap>{k}</Cap></span>
          <span className="ry-kx-say">{t("Tap", "짧게 누르면")}</span>
          <ActionBox label={draft.tap ? label(draft.tap) : undefined} empty={t("Choose", "고르기")} open={pickTap} onClick={() => setPickTap(!pickTap)} name={t("What a tap types", "짧게 누르면 입력할 키")} />
          {pickTap && <div className="ry-kx-pick">
            <FriendlyBindingPicker value={draft.tap ?? { b: "none" }} doc={doc} layerNames={layers}
              onChange={(nb) => { if (nb.b !== "kp") return; setDraft({ ...draft, tap: nb }); setPickTap(false); }} />
            <p className="ry-faint">{t("A tap can only type a key (with or without modifiers).", "짧게 누르면에는 일반 키(수정키 조합 포함)만 넣을 수 있어요.")}</p>
          </div>}
        </div>
        <div className="ry-kx-line">
          <span className="ry-kx-taps" aria-hidden="true"><Cap>{k}</Cap><span className="ry-kx-holdbar" /></span>
          <span className="ry-kx-say">{t("Hold", "길게 누르면")}</span>
          <div className="ry-chips" role="group" aria-label={t("Hold", "길게 누르면")}>
            {mt !== undefined && MODS.map(([name, code]) => <button key={code} type="button" className="ry-chip" aria-pressed={draft.hold === "m" + codes[code]} onClick={() => setDraft({ ...draft, hold: "m" + codes[code] })}>{name}</button>)}
            {lt !== undefined && layers.map((_, i) => i > 0 && <button key={"l" + i} type="button" className="ry-chip" aria-pressed={draft.hold === "l" + i} onClick={() => setDraft({ ...draft, hold: "l" + i })}>{t("{l} layer", "{l} 레이어", { l: layerName(layers, i) })}</button>)}
          </div>
        </div>
      </div>
      {draft.spot && !draft.tap && <p className="ry-note">{t("This key doesn't type a key now; choose what a tap types.", "이 키는 지금 글자를 입력하는 키가 아니에요. 짧게 누를 때 입력할 키를 골라 주세요.")}</p>}
      {draft.spot && draft.tap && draft.hold && <p className="ry-faint">{t("{k}: tap → {k}, hold → {h} while held.", "{k}: 짧게 → {k}, 누르고 있는 동안 → {h}", { k, h })}</p>}
      <div className="ry-kx-foot">
        <Msg msg={msg} />
        <button type="button" className="ry-outline" disabled={busy} onClick={() => setDraft(null)}>{t("Cancel", "취소")}</button>
        <button type="button" className="ry-primary" disabled={busy || !ready || !p.conn} onClick={() => void register()}>{busy ? t("Saving…", "저장 중…") : t("Register on the key", "키에 등록")}</button>
      </div>
    </section>}

    {kinds.length > 0 && <section className="ry-kx-sec" aria-label={t("Timing", "판정")}>
      <h3 className="ry-kx-h">{t("How long is a hold?", "얼마나 눌러야 '길게'일까요?")}</h3>
      <div className="ry-chips" role="group" aria-label={t("Hold time", "길게 판정 시간")}>
        {HOLD_TERMS.map((x) => <button key={x.ms} type="button" className="ry-chip" disabled={busy} aria-pressed={term === x.ms}
          onClick={() => void setTiming({ "tapping-term-ms": x.ms }, t("Hold time saved: {n} ms.", "판정 시간을 {n}ms로 저장했어요.", { n: x.ms }))}>{x.label()} <span className="ry-faint">{x.ms}ms</span></button>)}
        <label className="ry-inline">{t("Custom", "직접")}
          <input type="number" className="ry-num" min={50} max={2000} value={ownTerm ?? String(term)} aria-label={t("Hold time (ms)", "길게 판정 시간 (ms)")}
            onChange={(e) => setOwnTerm(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            onBlur={() => { if (ownTerm === null) return; const n = Math.max(50, Math.min(2000, Math.round(Number(ownTerm)))); setOwnTerm(null);
              if (Number.isFinite(n) && n !== term) void setTiming({ "tapping-term-ms": n }, t("Hold time saved: {n} ms.", "판정 시간을 {n}ms로 저장했어요.", { n })); }} /> ms</label>
      </div>
      <p className="ry-faint">{t("Pressed longer than this = hold. Applies to every tap·hold key.", "이보다 오래 누르면 '길게'예요. 모든 탭·홀드 키에 같이 적용돼요.")}</p>
      <details className="ry-kx-more">
        <summary>{t("When another key is pressed while holding (advanced)", "누른 채 다른 키를 누르면 (고급)")}</summary>
        <div className="ry-choices" role="radiogroup" aria-label={t("Decision", "판정 방식")}>
          {FLAVORS.map((f) => <label key={f} className={"ry-choice" + (flavor === f ? " is-on" : "")}>
            <input type="radio" name="ry-kx-flavor" checked={flavor === f} disabled={busy} onChange={() => void setTiming({ flavor: f }, t("Saved.", "저장했어요."))} />
            <span><strong>{FLAVOR_TEXT[f][0]()}</strong><span className="ry-faint">{FLAVOR_TEXT[f][1]()}</span></span>
          </label>)}
        </div>
        <label className="ry-choice">
          <input type="checkbox" checked={quick > 0} disabled={busy} onChange={(e) => void setTiming({ "quick-tap-ms": e.target.checked ? 175 : 0 }, t("Saved.", "저장했어요."))} />
          <span><strong>{t("Tap, then hold = repeat", "톡 누르고 바로 꾹 = 반복")}</strong><span className="ry-faint">{t("Tap and quickly press again and hold: the key repeats instead of holding (e.g. holding Space).", "한 번 누른 뒤 바로 다시 누르고 있으면 '길게' 대신 그 키가 반복돼요 (예: 스페이스 길게).")}</span></span>
        </label>
        <label className="ry-choice">
          <input type="checkbox" checked={idle > 0} disabled={busy} onChange={(e) => void setTiming({ "require-prior-idle-ms": e.target.checked ? 150 : 0 }, t("Saved.", "저장했어요."))} />
          <span><strong>{t("While typing fast, always tap", "빠르게 타이핑하는 중엔 항상 '짧게'")}</strong><span className="ry-faint">{t("Pressed right after another key → always a tap, so no stray modifier mid-word.", "다른 키 바로 뒤에 누르면 항상 '짧게'로 처리해요. 단어 중간에 Ctrl이 잘못 걸리는 걸 막아요.")}</span></span>
        </label>
      </details>
    </section>}
  </div>;
}
