import { exportProfile, importProfile, downloadText } from "../runtime/profileFile";
import { ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Code, Copy, Lock, Plus, Trash2 } from "lucide-react";
import { Board, confPath, links, matchesDevice, useMyBoards } from "../keyboards";
import { KeyRect, LAYOUTS } from "./layouts";
import { ConnectionContext } from "../../rpc/ConnectionContext";
import { LockStateContext } from "../../rpc/LockStateContext";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import { call_rpc } from "../../rpc/logging";
import { hid_usage_get_labels, hid_usage_page_and_id_from_usage } from "../../hid-usages";
import { tidyLabels } from "../hidLabels";
import { BindingPicker, defaultBinding } from "./BindingPicker";
import {
  allIds,
  BehaviorDoc,
  bindingLabel,
  Combo,
  emptyDoc,
  generateDtsi,
  Macro,
  MacroStep,
  makeId,
  problems,
  TapDance,
  Setting,
  SETTING_SPECS,
} from "./model";
import { commitFiles, readFile, useMe } from "../api";
import { SignInPrompt, AccountRow } from "../SignIn";
import { addInclude, dirOf, hasInclude, layerNames } from "./keymapFile";
import { removeFound, scanKeymap, Scan } from "./importKeymap";
import { L, t, useLang } from "../i18n";
import { applyConf, Feature, FEATURES, isOn, parseConf, SLEEP_TIMEOUT } from "./features";
import { baseKeyName, baseLabels, findInKeymap, KeyLabel, keysAt, positionsAt, PowerDoc, powerPath, readPower, shortKey, wakeDtsi } from "../power";
import { useSub } from "../../usePubSub";
import { WakePicker } from "../PowerInfo";
import { KeyPress } from "../UnlockAnim";
import { TapHoldSettings } from "./TapHoldSettings";
import { BehaviorLab } from "./BehaviorLab";
import { FriendlyBindingPicker, friendlyLabel } from "./FriendlyBindingPicker";
import type { MacroItem } from "./labEngine";

import type { RpcConnection } from "@zmkfirmware/zmk-studio-ts-client/index";
import { compileDocument, loadRuntimeView, RuntimeView, viewDocument } from "../runtime/modelBridge";
import { makePreviewView } from "../runtime/preview";

const RUNTIME_BOARD: Board = {
  id: "runtime-development", name: "Runtime", note: "", repo: "hiryong/ryong-firmware",
  branch: "dev/keys-ryong-runtime", workflow: "", artifact: "", keymap: "device",
  match: ["BT60 V2", "ryong60"], layout: "60-ansi",
};

type Section = "combos" | "macros" | "tapDances";
export type RuntimeSection = Section | "settings";
type Tab = RuntimeSection;

const SECTIONS: { id: Tab; label: () => string; one: () => string; hint: () => string }[] = [
  {
    id: "combos",
    label: () => t("Combos", "콤보"),
    one: () => t("New combo", "새 콤보"),
    hint: () => t("Keys pressed together, e.g. J + K for Esc.", "여러 키를 동시에 눌러 다른 동작을 실행해요. 예: J + K → Esc"),
  },
  {
    id: "macros",
    label: () => t("Macros", "매크로"),
    one: () => t("New macro", "새 매크로"),
    hint: () => t("One key, a sequence of keys.", "키 하나로 여러 입력을 순서대로 실행해요."),
  },
  {
    id: "tapDances",
    label: () => t("Tap dances", "탭댄스"),
    one: () => t("New tap dance", "새 탭댄스"),
    hint: () => t("One key, a different action per number of taps.", "누르는 횟수에 따라 다른 동작을 해요."),
  },
  {
    id: "settings",
    label: () => t("Settings", "설정"),
    one: () => "",
    hint: () =>
      t(
        "Firmware features and behavior options.",
        "펌웨어 기능과 동작별 옵션이에요."
      ),
  },
];

interface Loaded {
  keymap: string;
  doc: BehaviorDoc;
  savedJson: string;
  layers: string[];
  /** config/<board>.conf and the board's defaults (from ryong-power.json) */
  conf: string;
  board: PowerDoc | null;
}

export const BehaviorsEditor = ({ connectedName, onRuntimeSaved, activeSection, embedded, onDirty, onView }: {
  connectedName?: string; onRuntimeSaved?: () => void; activeSection?: RuntimeSection;
  embedded?: boolean; onDirty?: (dirty: boolean) => void; onView?: (view: RuntimeView) => void;
}) => {
  const me = useMe();
  const mine = useMyBoards(me);
  const { conn } = useContext(ConnectionContext);
  const [previewChoice, setPreview] = useState(import.meta.env.VITE_RYONG_PREVIEW_ONLY === "1");
  // A connected keyboard (real or the virtual one) always wins over the offline preview.
  const preview = previewChoice && !conn;
  const intro = (
    <div className="ry-sec">
      <h1 className="ry-h1">{t("Combos & Macros", "콤보·매크로")}</h1>
      <p className="ry-lead">
        {t(
          "Combos, macros and tap dances live in the firmware. Save, then update the firmware to use them.",
          "콤보, 매크로, 탭댄스는 펌웨어에 들어가요. 저장한 뒤 펌웨어를 업데이트하면 쓸 수 있어요."
        )}
      </p>
    </div>
  );
  if (import.meta.env.VITE_RYONG_RUNTIME === "1") {
    const runtimeIntro = <div className="ry-sec">
      <h1 className="ry-h1">{t("Dynamic settings", "동적 설정")}</h1>
      <p className="ry-lead">{preview
        ? t("Preview · stored in this browser only. No keyboard is changed.", "미리보기 · 이 브라우저에만 저장하며 실제 키보드는 변경하지 않습니다.")
        : t("Runtime development · edit the connected keyboard without rebuilding.", "런타임 개발본 · 연결한 키보드에 재빌드 없이 저장합니다.")}</p>
    </div>;
    if (!conn && !preview) return <div className="ry-beh">{runtimeIntro}
      <p className="ry-note">{t("Connect a supported test keyboard and unlock Studio.", "시험용 키보드를 연결하고 Studio 잠금을 풀어 주세요.")}</p>
      <button className="ry-primary" onClick={() => setPreview(true)}>{t("Explore preview", "연결 없이 미리보기")}</button>
    </div>;
    return <Editor key={preview ? "preview" : conn?.label} boards={[RUNTIME_BOARD]}
      connectedName={connectedName} intro={embedded ? null : runtimeIntro} activeSection={activeSection} embedded={embedded} onDirty={onDirty} onView={onView} runtimeConn={preview ? undefined : conn ?? undefined} preview={preview} onRuntimeSaved={onRuntimeSaved} />;
  }
  if (me.loading) return intro;
  if (!me.user || me.repos.length === 0)
    return (
      <div className="ry-beh">
        {intro}
        <SignInPrompt title={t("Sign in with GitHub to start", "시작하려면 GitHub로 로그인하세요")}>
          {t(
            "Sign in with GitHub to edit your own firmware. No keyboard of your own yet? Use “Make it yours” on a shared keyboard.",
            "내 펌웨어를 편집하려면 GitHub로 로그인하세요. 아직 내 키보드가 없다면 공용 키보드에서 “내 것으로 만들기”를 누르세요."
          )}
        </SignInPrompt>
      </div>
    );
  if (mine.loading)
    return (
      <div className="ry-beh">
        {intro}
        <p className="ry-muted">{t("Loading your keyboards…", "내 키보드를 불러오는 중…")}</p>
      </div>
    );
  if (mine.boards.length === 0)
    return (
      <div className="ry-beh">
        {intro}
        <AccountRow />
        <p className="ry-note">
          {t(
            "No keyboard of your own yet? Use “Make it yours” on a shared keyboard.",
            "아직 내 키보드가 없다면 공용 키보드에서 “내 것으로 만들기”를 누르세요."
          )}
        </p>
      </div>
    );
  return <Editor boards={mine.boards} connectedName={connectedName} intro={intro} />;
};

/** Keys of the connected keyboard (real layout, first-layer labels) for the combo picker. */
function useLiveKeys(enabled: boolean): KeyRect[] | null {
  const { conn } = useContext(ConnectionContext);
  const lock = useContext(LockStateContext);
  const [keys, setKeys] = useState<KeyRect[] | null>(null);
  useEffect(() => {
    if (!enabled || !conn || lock !== LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED) return setKeys(null);
    let ignore = false;
    (async () => {
      const pl = (await call_rpc(conn, { keymap: { getPhysicalLayouts: true } }))?.keymap?.getPhysicalLayouts;
      const km = (await call_rpc(conn, { keymap: { getKeymap: true } }))?.keymap?.getKeymap;
      const layout = pl?.layouts?.[pl.activeLayoutIndex];
      if (ignore || !layout) return;
      const base = km?.layers?.[0]?.bindings || [];
      setKeys(
        layout.keys.map((k, i) => {
          const p1 = base[i]?.param1 ?? 0;
          let label = String(i);
          if (p1 > 0xffff) {
            const [page, id] = hid_usage_page_and_id_from_usage(p1);
            label = tidyLabels(hid_usage_get_labels(page & 0xff, id)).short?.replace(/^Keyboard /, "") || label;
          }
          return [k.x, k.y, k.width, k.height, label] as KeyRect;
        })
      );
    })().catch(() => setKeys(null));
    return () => {
      ignore = true;
    };
  }, [enabled, conn, lock]);
  return keys;
}

/** What each base-layer key does on the connected, unlocked keyboard (editor changes included). */
function useLiveLabels(enabled: boolean): KeyLabel[] | null {
  const { conn } = useContext(ConnectionContext);
  const lock = useContext(LockStateContext);
  const [labels, setLabels] = useState<KeyLabel[] | null>(null);
  const [tick, setTick] = useState(0);
  useSub("rpc_notification.keymap.unsavedChangesStatusChanged", () => setTick((n) => n + 1));
  useEffect(() => {
    if (!enabled || !conn || lock !== LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED) return setLabels(null);
    let ignore = false;
    (async () => {
      const ids = (await call_rpc(conn, { behaviors: { listAllBehaviors: true } }))?.behaviors?.listAllBehaviors?.behaviors || [];
      const names: Record<number, string> = {};
      for (const id of ids) {
        const d = (await call_rpc(conn, { behaviors: { getBehaviorDetails: { behaviorId: id } } }))?.behaviors?.getBehaviorDetails;
        if (d) names[d.id] = d.displayName;
      }
      const km = (await call_rpc(conn, { keymap: { getKeymap: true } }))?.keymap?.getKeymap;
      if (ignore || !km) return;
      const layerName = (n: number) => km.layers.find((l) => l.id === n)?.name || km.layers[n]?.name || `layer ${n}`;
      const hid = (u: number) => {
        const [page, id] = hid_usage_page_and_id_from_usage(u);
        const l = tidyLabels(hid_usage_get_labels(page & 0xff, id));
        // left/right modifiers keep their side ("L Ctrl" → LCtrl); the space bar is "Space", not ␣
        if (l.med && /^[LR] /.test(l.med)) return l.med.replace(" ", "");
        if (l.short === "␣") return "Space";
        return shortKey(l.short?.replace(/^Keyboard /, "") || "?");
      };
      setLabels(
        (km.layers[0]?.bindings || []).map((b) => {
          const n = names[b.behaviorId] || "";
          if (/^key press$/i.test(n)) return { main: hid(b.param1) };
          if (/momentary layer/i.test(n)) return { main: "Fn", sub: layerName(b.param1) };
          if (/layer.?tap/i.test(n)) return { main: hid(b.param2), sub: t("hold: {l}", "홀드: {l}", { l: layerName(b.param1) }) };
          if (/mod.?tap/i.test(n)) return { main: hid(b.param2), sub: t("hold: mod", "홀드: 모디") };
          if (/toggle layer/i.test(n)) return { main: "Tog", sub: layerName(b.param1) };
          if (/to layer/i.test(n)) return { main: "To", sub: layerName(b.param1) };
          return { main: n || "?" };
        })
      );
    })().catch(() => !ignore && setLabels(null));
    return () => {
      ignore = true;
    };
  }, [enabled, conn, lock, tick]);
  return labels;
}

/** Open the editor on this keyboard next time (Firmware → Edit defaults). */
let preferred: string | null = null;
export const preferBoard = (b: Board) => (preferred = `${b.repo}|${b.id}`);

/** One keyboard's firmware contents (combos, macros, tap dances, settings), opened from its card. */
export const KeyboardEditor = ({ board, connectedName, onDirty }: { board: Board; connectedName?: string; onDirty?: (d: boolean) => void }) => (
  <Editor key={board.repo + board.id} boards={[board]} connectedName={connectedName} intro={null} onDirty={onDirty} />
);

const Editor = ({
  boards,
  connectedName,
  intro,
  onDirty,
  runtimeConn,
  preview = false,
  activeSection,
  embedded,
  onView,
  onRuntimeSaved,
}: {
  boards: Board[];
  connectedName?: string;
  intro: ReactNode;
  onDirty?: (d: boolean) => void;
  runtimeConn?: RpcConnection;
  preview?: boolean;
  activeSection?: RuntimeSection;
  embedded?: boolean;
  onView?: (view: RuntimeView) => void;
  onRuntimeSaved?: () => void;
}) => {
  const lang = useLang();
  const runtime = !!runtimeConn || preview;
  const runtimeLock = useContext(LockStateContext);
  const [runtimeView, setRuntimeView] = useState<RuntimeView | null>(null);
  const [kb, setKb] = useState<Board>(() => {
    const want = preferred;
    preferred = null;
    return boards.find((k) => `${k.repo}|${k.id}` === want) ?? boards.find((k) => matchesDevice(k, connectedName)) ?? boards[0];
  });
  const liveKeys = useLiveKeys(matchesDevice(kb, connectedName));
  const liveLabels = useLiveLabels(matchesDevice(kb, connectedName));
  const comboKeys = liveKeys ?? LAYOUTS[kb.layout || "60-ansi"] ?? [];
  const [localSection, setSection] = useState<Tab>("combos");
  const section = activeSection ?? localSection;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [doc, setDoc] = useState<BehaviorDoc>(emptyDoc());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  /** the keymap with hand-written items taken out, once they were brought here (saved together) */
  const [movedKeymap, setMovedKeymap] = useState<string | null>(null);
  /** firmware feature switches changed here, saved with everything else (null = back to the board default) */
  const [confEdits, setConfEdits] = useState<Record<string, string | null>>({});
  /** a new wake key (key position), saved with everything else */
  const [wakeNow, setWakeNow] = useState<number | null>(null);

  const dir = dirOf(kb.keymap);
  const jsonPath = `${dir}ryong-behaviors.json`;
  const dtsiPath = `${dir}ryong-behaviors.dtsi`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSaved(null);
    try {
      if (runtime) {
        const view = preview ? await makePreviewView() : await loadRuntimeView(runtimeConn!);
        const d = viewDocument(view);
        setRuntimeView(view);
        setLoaded({ keymap: "", doc: d, savedJson: JSON.stringify(d), layers: view.layerNames, conf: "", board: null });
        setDoc(d); setMovedKeymap(null); setConfEdits({}); setWakeNow(null); setOpenId(null);
        return;
      }
      const [keymap, json, conf, board] = await Promise.all([
        readFile(kb.repo, kb.branch, kb.keymap),
        readFile(kb.repo, kb.branch, jsonPath),
        readFile(kb.repo, kb.branch, confPath(kb)).catch(() => null),
        readPower(kb).catch(() => null),
      ]);
      if (keymap === null) throw new Error(t("Couldn't find {f} on {b}.", "{b}에서 {f}를 찾지 못했어요.", { f: kb.keymap, b: kb.branch }));
      const d: BehaviorDoc = json ? { ...emptyDoc(), ...JSON.parse(json) } : emptyDoc();
      setLoaded({ keymap, doc: d, savedJson: JSON.stringify(d), layers: layerNames(keymap), conf: conf ?? "", board });
      setDoc(d);
      setMovedKeymap(null);
      setConfEdits({});
      setWakeNow(null);
      setOpenId(null);
    } catch (e) {
      setLoaded(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [kb, jsonPath, runtimeConn, preview, runtime, runtimeConn ? runtimeLock : null]);

  // The connection the loaded document came from: a reconnect (or another keyboard) gives a new
  // connection object, and the old session must not be used for saving.
  const loadedFrom = useRef<unknown>(undefined);
  useEffect(() => {
    // Lock notifications must never replace an in-progress editor document.
    if (runtime && runtimeConn && runtimeLock !== LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED) return;
    if (runtime && loaded && loadedFrom.current === runtimeConn) return;
    loadedFrom.current = runtimeConn;
    void load();
  }, [load, runtimeLock]);

  useEffect(() => { if (runtimeView) onView?.(runtimeView); }, [runtimeView, onView]);

  const rewake = !!loaded?.board && wakeNow !== null && wakeNow !== loaded.board.wake;
  const dirty = !!loaded && (JSON.stringify(doc) !== loaded.savedJson || movedKeymap !== null || Object.keys(confEdits).length > 0 || rewake);
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
  const draftKey = "ryong-runtime-editor-draft:" + (preview ? "preview" : runtimeConn?.label ?? "unknown");
  const [draftWarning, setDraftWarning] = useState<string | null>(null);
  useEffect(() => {
    if (!runtime || !loaded || !runtimeView) return;
    try {
      if (dirty) localStorage.setItem(draftKey, exportProfile(doc, runtimeView));
      // Keep the draft until a successful explicit save/discard, including unmount.
    } catch { setDraftWarning(t("Browser draft storage is unavailable. Download a backup before leaving.", "임시 저장을 사용할 수 없습니다. 나가기 전에 백업을 다운로드하세요.")); }
  }, [runtime, dirty, doc, runtimeView, draftKey]);
  useEffect(() => {
    if (!runtime || !dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [runtime, dirty]);
  // what the keymap file defines by hand (not yet brought here)
  const scan: Scan | null = useMemo(
    () => (loaded ? scanKeymap(movedKeymap ?? loaded.keymap, allIds(doc), new Set((doc.settings ?? []).map((x) => x.behavior))) : null),
    [loaded, movedKeymap, doc]
  );
  const bringHere = () => {
    if (!loaded || !scan?.found.length) return;
    const next = { ...doc, combos: [...doc.combos], macros: [...doc.macros], tapDances: [...doc.tapDances], settings: [...(doc.settings ?? [])] };
    for (const f of scan.found) {
      if (f.kind === "combo") next.combos.push(f.item as Combo);
      else if (f.kind === "macro") next.macros.push(f.item as Macro);
      else if (f.kind === "setting") next.settings.push(f.item as Setting);
      else next.tapDances.push(f.item as TapDance);
    }
    setMovedKeymap(removeFound(movedKeymap ?? loaded.keymap, scan.found));
    setDoc(next);
    const first = scan.found[0].kind;
    setSection(first === "combo" ? "combos" : first === "macro" ? "macros" : first === "setting" ? "settings" : "tapDances");
  };
  const issues = useMemo(() => problems(doc), [doc, lang]);
  const layers = loaded?.layers ?? [];
  const dtsi = useMemo(() => generateDtsi(doc, Math.max(layers.length, 1)), [doc, layers.length]);

  const switchKeyboard = (k: Board) => {
    if (k.id === kb.id && k.repo === kb.repo) return;
    if (dirty && !confirm(t("Discard unsaved changes?", "저장하지 않은 변경 사항이 있어요. 버리고 나갈까요?"))) return;
    setKb(k);
  };

  const save = async () => {
    if (!loaded) return;
    setSaving(true);
    setError(null);
    setSaveError(null);
    try {
      if (runtime) {
        if (!runtimeView) throw new Error("Runtime device has not loaded.");
        const desired = compileDocument(doc, runtimeView);
        const journalKey = "ryong-runtime-pending:" + (preview ? "preview" : runtimeConn!.label);
        const before = await runtimeView.session.refreshKeymap(runtimeView.snapshot);
        const result = await runtimeView.session.save(before, desired, {
          prepare(before, next) {
            const previous=localStorage.getItem(journalKey);
            if(previous){
              const archiveKey=journalKey+":recovery-history";
              const archive=JSON.parse(localStorage.getItem(archiveKey)||"[]");
              localStorage.setItem(archiveKey,JSON.stringify([JSON.parse(previous),...archive].slice(0,5)));
            }
            localStorage.setItem(journalKey, JSON.stringify({ version: 1, device: connectedName, at: Date.now(), before, desired: next, beforeBackup: exportProfile(viewDocument({ ...runtimeView, snapshot: before }), runtimeView) }, (_key, value) => value instanceof Uint8Array ? { type: "uint8", bytes: Array.from(value) } : value));
          },
          complete() {
            const pending = localStorage.getItem(journalKey);
            if (pending) {
              const historyKey = journalKey + ":history";
              const history = JSON.parse(localStorage.getItem(historyKey) || "[]");
              localStorage.setItem(historyKey, JSON.stringify([JSON.parse(pending), ...history].slice(0, 5)));
            }
            localStorage.removeItem(journalKey);
          },
        });
        const view = { ...runtimeView, snapshot: result };
        const nextDoc = viewDocument(view);
        // New items get their keyboard id on save; keep the same card open so the person stays where they were.
        if (openId) for (const k of ["combos", "macros", "tapDances"] as const) {
          const i = doc[k].findIndex((x) => x.id === openId);
          if (i >= 0) { setOpenId(nextDoc[k][i]?.id ?? null); break; }
        }
        setRuntimeView(view); setDoc(nextDoc);
        setLoaded({ ...loaded, doc: nextDoc, savedJson: JSON.stringify(nextDoc) });
        localStorage.removeItem(draftKey);
        setSaved(preview ? "preview" : "runtime");
        if (!preview) onRuntimeSaved?.();
        return;
      }
      const files = [
        { path: jsonPath, content: JSON.stringify(doc, null, 2) + "\n" },
        { path: dtsiPath, content: dtsi },
      ];
      const keymapNow = movedKeymap ?? loaded.keymap;
      const edits = rewake ? { ...confEdits, RYONG_WAKE_POSITION: String(wakeNow) } : confEdits;
      const confNow = Object.keys(edits).length ? applyConf(loaded.conf, edits) : loaded.conf;
      if (confNow !== loaded.conf) files.push({ path: confPath(kb), content: confNow });
      let boardNow = loaded.board;
      if (rewake && loaded.board) {
        boardNow = { ...loaded.board, wake: wakeNow! };
        files.push({ path: powerPath(kb), content: JSON.stringify(boardNow, null, 2) + "\n" });
        files.push({ path: boardNow.dtsi, content: wakeDtsi(boardNow) });
      }
      if (movedKeymap !== null || !hasInclude(keymapNow)) files.push({ path: kb.keymap, content: addInclude(keymapNow) });
      const n = (a: unknown[], w: string) => (a.length ? `${a.length} ${w}${a.length === 1 ? "" : "s"}` : null);
      const summary = [n(doc.combos, "combo"), n(doc.macros, "macro"), n(doc.tapDances, "tap dance")].filter(Boolean).join(", ") || "none";
      const url = await commitFiles(kb.repo, kb.branch, files, `Update combos, macros and tap dances (${summary})\n\nSaved from keys.ryong.com`);
      setLoaded({ ...loaded, keymap: addInclude(keymapNow), savedJson: JSON.stringify(doc), conf: confNow, board: boardNow });
      setMovedKeymap(null);
      setConfEdits({});
      setWakeNow(null);
      setSaved(url);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // ---------- list editing helpers ----------
  const update = <K extends Section>(key: K, id: string, patch: Partial<BehaviorDoc[K][number]>) =>
    setDoc((d) => ({ ...d, [key]: (d[key] as any[]).map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const remove = (key: Section, id: string) => {
    if (runtime && key === "macros" && runtimeView) {
      const old = runtimeView.snapshot.macros.find(macro => "runtime_macro_" + macro.slot === id);
      const references = old ? runtimeView.snapshot.keymap?.layers.flatMap(layer => layer.bindings).filter(binding =>
        binding.behaviorId === runtimeView.catalog.ref && binding.param1 === old.slot).length ?? 0 : 0;
      if (references && !confirm(t("This macro is assigned to {n} keys. Those bindings will become None when saved. Delete?",
        "이 매크로가 지정된 키 {n}개는 저장하면 None으로 바뀝니다. 삭제할까요?", { n: references }))) return;
    }
    const used = [...doc.combos.map((c) => c.binding), ...doc.tapDances.flatMap((x) => x.bindings), ...doc.macros.flatMap((m) => m.steps.map((s) => ("binding" in s ? s.binding : null)))].some(
      (b) => b?.b === "ref" && b.id === id
    );
    if (used && !confirm(t("Something else uses this. Delete it anyway?", "다른 항목에서 이걸 쓰고 있어요. 그래도 삭제할까요?"))) return;
    // the unlock combo is the one way in that the editor can't break
    if (
      key === "combos" &&
      doc.combos.find((c) => c.id === id)?.binding.b === "studio_unlock" &&
      !confirm(
        t(
          "Without this combo, unlocking the keyboard gets hard. Delete it anyway?",
          "이 콤보가 없으면 잠금을 풀기 어려워져요. 그래도 삭제할까요?"
        )
      )
    )
      return;
    // a key in the keymap file that uses it would break the firmware build
    const km = movedKeymap ?? loaded?.keymap ?? "";
    if (key !== "combos" && new RegExp(`&${id}(?![\\w-])`).test(km.replace(/\/\/.*$/gm, "")) &&
      !confirm(t("A key in the keymap uses this; the firmware won't build without it. Delete anyway?", "키맵에서 이걸 쓰는 키가 있어서, 삭제하면 펌웨어를 만들 수 없어요. 그래도 삭제할까요?")))
      return;
    setDoc((d) => ({ ...d, [key]: (d[key] as any[]).filter((x) => x.id !== id) }));
  };
  /** A copy right below the original, named "… copy", opened for editing. */
  const duplicate = (key: Section, id: string) => {
    const list = doc[key] as (Combo | Macro | TapDance)[];
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return;
    const names = new Set(list.map((x) => x.name));
    let name = t("{n} copy", "{n} 복사본", { n: list[i].name });
    for (let k = 2; names.has(name); k++) name = t("{n} copy {k}", "{n} 복사본 {k}", { n: list[i].name, k });
    const prefix = key === "combos" ? "combo" : key === "macros" ? "macro" : "td";
    const copy = { ...structuredClone(list[i]), name, id: makeId(prefix, name, allIds(doc)) };
    setDoc((d) => {
      const next = [...(d[key] as any[])];
      next.splice(i + 1, 0, copy);
      return { ...d, [key]: next };
    });
    setOpenId(copy.id);
  };
  const add = (key: Section) => {
    const taken = allIds(doc);
    let item: Combo | Macro | TapDance;
    if (key === "combos") {
      const name = `Combo ${doc.combos.length + 1}`;
      item = { id: makeId("combo", name, taken), name, keys: [], layers: [], timeout: 50, binding: defaultBinding("kp") };
    } else if (key === "macros") {
      const name = `Macro ${doc.macros.length + 1}`;
      item = { id: makeId("macro", name, taken), name, wait: 15, tap: 15, steps: [{ t: "text", text: "" }] };
    } else {
      const name = `Tap dance ${doc.tapDances.length + 1}`;
      item = { id: makeId("td", name, taken), name, term: 200, bindings: [defaultBinding("kp"), defaultBinding("kp")] };
    }
    setDoc((d) => ({ ...d, [key]: [...(d[key] as any[]), item] }));
    setOpenId(item.id);
  };

  return (
    <div className="ry-beh">
      {intro}
      {intro !== null && !runtime && <AccountRow />}

      {boards.length > 1 && (
        <div className="ry-gap" role="tablist" aria-label={t("Keyboard", "키보드")}>
          {boards.map((k) => (
            <button key={k.repo + k.id} className="ry-pillbtn" aria-pressed={k.id === kb.id && k.repo === kb.repo} onClick={() => switchKeyboard(k)}>
              {k.name}
            </button>
          ))}
        </div>
      )}

      {loading && <p className="ry-muted">{t("Loading {f}…", "{f} 불러오는 중…", { f: kb.keymap })}</p>}
      {error && <p className="ry-note ry-danger">{error}</p>}
      {runtime && !loading && <div className="ry-row">
        <p className="ry-faint">{t("Existing firmware defaults remain active. This list edits additional runtime entries.", "기존 펌웨어 기본 동작은 유지됩니다. 이 목록에서는 추가 동적 설정을 편집합니다.")}</p>
        <button className="ry-text" disabled={saving || !runtimeView} onClick={() => {
          try {
            const savedDraft = localStorage.getItem(draftKey);
            if (!savedDraft || !runtimeView) throw new Error(t("No saved editor draft.", "복원할 편집 내용이 없습니다."));
            if (dirty && !confirm(t("Replace current edits with the saved draft?", "현재 편집 내용을 임시 저장본으로 바꿀까요?"))) return;
            setDoc(importProfile(savedDraft, runtimeView)); setError(null);
          } catch (error) { setError(String(error)); }
        }}>{t("Recover editor draft", "편집 내용 복원")}</button>
        <button className="ry-text" disabled={saving} onClick={() => { if (!dirty || confirm(t("Discard unsaved changes?", "저장하지 않은 변경을 버리고 다시 불러올까요?"))) void load(); }}>{t("Reload device", "다시 불러오기")}</button>
        <button className="ry-text" disabled={saving || !runtimeView} onClick={()=>runtimeView && downloadText("ryong-dynamic-backup.json",exportProfile(doc,runtimeView))}>{t("Export dynamic settings","동적 설정 백업")}</button>
        <label className="ry-text">{t("Import backup","백업 불러오기")}<input aria-label={t("Import runtime backup","동적 설정 백업 불러오기")} type="file" hidden accept=".json,application/json" disabled={saving} onChange={async e=>{
          const file=e.currentTarget.files?.[0];e.currentTarget.value="";
          if(!file || !runtimeView)return;
          try {if(file.size>262144)throw new Error("Backup exceeds 256 KiB.");setDoc(importProfile(await file.text(),runtimeView));setError(null);}
          catch(error){setError(String(error));}
        }}/></label>
        <button className="ry-text" disabled={saving || !runtimeView} onClick={()=>{
          const key="ryong-runtime-pending:"+(preview?"preview":runtimeConn!.label);
          const raw=localStorage.getItem(key);
          if(!raw){setError(t("No interrupted save journal.","중단된 저장 기록이 없습니다."));return;}
          const record=JSON.parse(raw);
          downloadText("ryong-interrupted-save.json",raw);
          if(record.beforeBackup && runtimeView){try{setDoc(importProfile(record.beforeBackup,runtimeView));setError(t("Previous settings loaded for review. Reload the keyboard first if its state changed, then import the exported backup. Save explicitly to restore.","이전 설정을 검토용으로 불러왔습니다. 장치 상태가 바뀌었다면 먼저 다시 불러오고 백업을 가져오세요. 복원은 저장 버튼을 눌러야 적용됩니다."));}catch(error){setError(String(error));}}
        }}>{t("Interrupted save recovery","중단된 저장 복구")}</button>
      </div>}

      {draftWarning && <p role="alert" className="ry-note">{draftWarning}</p>}
      {loaded && (
        <fieldset className="ry-workspace-fields" disabled={saving}>
          <div className="ry-row" style={{ borderBottom: "1px solid var(--line)" }}>
            <div className="ry-tabs" hidden={embedded}>
              {SECTIONS.filter(s => !runtime || s.id === "combos" || s.id === "macros" || !!runtimeView?.snapshot.advanced).map((s) => (
                <button key={s.id} className="ry-tab" aria-pressed={section === s.id} onClick={() => setSection(s.id)}>
                  {s.label()}
                  <span className="ry-count">{(doc[s.id] ?? []).length}</span>
                </button>
              ))}
            </div>
            {!runtime && <button className="ry-text" onClick={() => setShowCode((v) => !v)}>
              <Code style={{ width: 14, height: 14, display: "inline", marginRight: 6 }} />
              {showCode ? t("Hide code", "코드 숨기기") : t("Show code", "코드 보기")}
            </button>}
          </div>

          {scan && scan.found.length > 0 && (
            <div className="ry-card">
              <div className="ry-card-t">
                {t("Already in your keymap file", "키맵 파일에 이미 있어요")}
              </div>
              <p className="ry-muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
                {t(
                  "{list} are written in {f}. Bring them here to edit them; they keep working.",
                  "{f}에 직접 작성된 항목: {list}. 여기로 가져오면 편집할 수 있고, 동작은 그대로예요.",
                  { list: scan.found.map((f) => f.title).join(", "), f: kb.keymap.split("/").pop()! }
                )}
              </p>
              <div className="ry-gap">
                <button className="ry-outline" onClick={bringHere}>
                  {t("Bring them here", "여기로 옮기기")}
                </button>
                <span className="ry-faint">{t("Nothing changes until you save.", "저장하기 전까지는 아무것도 바뀌지 않아요.")}</span>
              </div>
            </div>
          )}
          {scan && scan.left.length > 0 && (
            <p className="ry-faint">
              {t("Stays in the keymap file: {l}", "키맵 파일에 남는 것: {l}", {
                l: scan.left.map((x) => (x.why ? `${x.what} — ${x.why}` : x.what)).join(" · "),
              })}
            </p>
          )}
          {movedKeymap !== null && (
            <p className="ry-note">
              {t(
                "Saving removes them from {f}.",
                "저장하면 {f}에서 빠져요.",
                { f: kb.keymap.split("/").pop()! }
              )}
            </p>
          )}

          {showCode ? (
            <pre className="ry-pre">{dtsi}</pre>
          ) : (
            <div className="ry-sec">
              {!(runtime && section === "settings") && <p className="ry-muted">{SECTIONS.find((s) => s.id === section)!.hint()}</p>}

              {section === "combos" &&
                doc.combos.map((c) => (
                  <Item
                    key={c.id}
                    title={c.name}
                    summary={`${c.keys.map((p) => comboKeys[p]?.[4] ?? p).join(" + ") || t("No keys yet", "아직 키 없음")} → ${friendlyLabel(c.binding, doc, layers)}`}
                    open={openId === c.id}
                    onToggle={() => setOpenId(openId === c.id ? null : c.id)}
                    onDelete={() => remove("combos", c.id)}
                    onCopy={() => duplicate("combos", c.id)}
                    keep={
                      c.binding.b === "studio_unlock"
                        ? t(
                            "Needed to unlock the keyboard for editing, so it can't be copied or deleted. Its keys can be changed.",
                            "이 콤보로 잠금을 풀어야 편집할 수 있어서 복사와 삭제를 막아 두었어요. 키는 바꿀 수 있어요."
                          )
                        : undefined
                    }
                  >
                    {c.keys.length >= 2 && c.keys.length <= 4 && (
                      <BehaviorLab lab={{ kind: "combo", timeout: c.timeout, comboLabel: friendlyLabel(c.binding, doc, layers),
                        keyLabels: c.keys.map((p) => comboKeys[p]?.[4] ?? String(p)) }} />
                    )}
                    <Field label={t("Name", "이름")}>
                      <input type="text" value={c.name} onChange={(e) => update("combos", c.id, { name: e.target.value })} />
                    </Field>
                    <Field label={t("Keys to press together", "함께 누를 키") + (c.keys.length ? t(" · {n} chosen", " · {n}개 선택", { n: c.keys.length }) : "")}>
                      <ComboKeys keys={comboKeys} value={c.keys} onChange={(keys) => update("combos", c.id, { keys })} />
                    </Field>
                    <Field label={t("Does", "동작")}>
                      {c.binding.b === "studio_unlock" ? (
                        <span className="ry-code" style={{ alignSelf: "flex-start", width: "fit-content" }}>{bindingLabel(c.binding, doc, layers)}</span>
                      ) : (
                        <FriendlyBindingPicker value={c.binding} onChange={(binding) => update("combos", c.id, { binding })} doc={doc} layerNames={layers} />
                      )}
                    </Field>
                    <Field label={t("Works on", "적용 레이어")}>
                      <div className="ry-gap">
                        <button className="ry-chip" aria-pressed={c.layers.length === 0} onClick={() => update("combos", c.id, { layers: [] })}>
                          {t("All layers", "모든 레이어")}
                        </button>
                        {layers.map((n, i) => (
                          <button
                            key={i}
                            className="ry-chip"
                            aria-pressed={c.layers.includes(i)}
                            onClick={() =>
                              update("combos", c.id, { layers: c.layers.includes(i) ? c.layers.filter((x) => x !== i) : [...c.layers, i] })
                            }
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </Field>
                    <Field label="timeout-ms" hint={t("All keys within this time. Usually 30–80.", "모든 키를 이 시간 안에 눌러야 해요. 보통 30–80.")}>
                      <Num value={c.timeout} onChange={(timeout) => update("combos", c.id, { timeout })} min={10} max={500} />
                    </Field>
                  </Item>
                ))}

              {section === "macros" &&
                doc.macros.map((m) => (
                  <Item
                    key={m.id}
                    title={m.name}
                    summary={m.steps.length === 1 ? t("1 step", "1단계") : t("{n} steps", "{n}단계", { n: m.steps.length })}
                    open={openId === m.id}
                    onToggle={() => setOpenId(openId === m.id ? null : m.id)}
                    onDelete={() => remove("macros", m.id)}
                    onCopy={() => duplicate("macros", m.id)}
                    keep={runtimeView?.behaviorNames?.includes(m.name) ? t(
                      "Built into the firmware and played by keys that call it by this name, so it can't be renamed or deleted. Its steps can be changed.",
                      "펌웨어에 들어 있던 매크로예요. 키가 이 이름으로 불러서 쓰기 때문에 이름 변경과 삭제는 막아 두었어요. 단계는 바꿀 수 있어요.") : undefined}
                  >
                    <Field label={t("Name", "이름")} hint={runtimeView?.behaviorNames?.includes(m.name) ? t("Keys use this name.", "키가 이 이름을 써요.") : t("Name in the behavior list.", "동작 목록에 보이는 이름.")}>
                      <input type="text" value={m.name} disabled={!!runtimeView?.behaviorNames?.includes(m.name) && loaded?.doc.macros.some((x) => x.id === m.id && x.name === m.name)}
                        onChange={(e) => update("macros", m.id, { name: e.target.value })} />
                    </Field>
                    <Field label={t("Steps", "단계")}>
                      <MacroSteps
                        macro={m}
                        doc={doc}
                        layers={layers}
                        onChange={(steps) => update("macros", m.id, { steps })}
                      />
                    </Field>
                    {m.steps.length > 0 && <BehaviorLab lab={{ kind: "macro", name: m.name, wait: m.wait, tap: m.tap, steps: m.steps.map((st): MacroItem =>
                      st.t === "wait" ? { kind: "wait", label: "", ms: st.ms } : st.t === "text" ? { kind: "text", label: st.text } : { kind: st.t, label: friendlyLabel(st.binding, doc, layers) }) }} />}
                    <div className="ry-two">
                      <Field label="wait-ms" hint={t("Time between steps.", "단계 사이 시간이에요.")}>
                        <Num value={m.wait} onChange={(wait) => update("macros", m.id, { wait })} min={0} max={1000} />
                      </Field>
                      <Field label="tap-ms" hint={t("How long each tap is held.", "한 번 누르고 있는 시간이에요.")}>
                        <Num value={m.tap} onChange={(tap) => update("macros", m.id, { tap })} min={0} max={1000} />
                      </Field>
                    </div>
                  </Item>
                ))}

              {section === "tapDances" && runtime && <p className="ry-note">{t("One global interval; use the same value on every card. One to three actions. Assign the returned ID through Studio.", "판정 시간은 전체 공통입니다. 모든 카드에 같은 값을 입력하세요. 동작은 최대 3개이며 저장 후 ID를 Studio에서 지정합니다.")}</p>}
              {section === "tapDances" &&
                doc.tapDances.map((td) => (
                  <Item
                    key={td.id}
                    title={td.name}
                    summary={td.bindings.map((b) => friendlyLabel(b, doc, layers)).join(" · ")}
                    open={openId === td.id}
                    onToggle={() => setOpenId(openId === td.id ? null : td.id)}
                    onDelete={() => remove("tapDances", td.id)}
                    onCopy={() => duplicate("tapDances", td.id)}
                  >
                    <Field label={t("Name", "이름")} hint={t("Name in the behavior list.", "동작 목록에 보이는 이름.")}>
                      {runtime && td.id.startsWith("runtime_dance_") && <p className="ry-note">Studio · Runtime Tap Dance · ID {td.id.slice(14)}</p>}
                      <input type="text" value={td.name} onChange={(e) => update("tapDances", td.id, { name: e.target.value })} />
                    </Field>
                    <Field label={t("Taps", "탭")}>
                      <div className="ry-steps-ed">
                        {td.bindings.map((b, i) => (
                          <div key={i} className="ry-step">
                            <span className="ry-step-n">{i + 1}×</span>
                            <FriendlyBindingPicker
                              compact
                              value={b}
                              doc={doc}
                              layerNames={layers}
                              exclude={td.id}
                              onChange={(nb) => update("tapDances", td.id, { bindings: td.bindings.map((x, j) => (j === i ? nb : x)) })}
                            />
                            <button
                              className="ry-icon"
                              aria-label={t("Remove tap", "탭 삭제")}
                              disabled={td.bindings.length <= 2}
                              onClick={() => update("tapDances", td.id, { bindings: td.bindings.filter((_, j) => j !== i) })}
                            >
                              <Trash2 />
                            </button>
                          </div>
                        ))}
                        <button
                          className="ry-ghost"
                          disabled={runtime && td.bindings.length >= 3}
                          onClick={() => update("tapDances", td.id, { bindings: [...td.bindings, defaultBinding("kp")] })}
                        >
                          <Plus /> {t("Add a tap", "탭 추가")}
                        </button>
                      </div>
                    </Field>
                    {td.bindings.length > 0 && <BehaviorLab lab={{ kind: "tapDance", term: td.term, labels: td.bindings.map((b) => friendlyLabel(b, doc, layers)) }} />}
                    <Field label="tapping-term-ms" hint={t("Wait for the next tap. Usually 200.", "다음 탭을 기다리는 시간이에요. 보통 200.")}>
                      <Num value={td.term} onChange={(term) => runtime ? setDoc(d=>({...d,tapDances:d.tapDances.map(x=>({...x,term}))})) : update("tapDances", td.id, { term })} min={50} max={1000} />
                    </Field>
                  </Item>
                ))}

              {section === "settings" && (
                <>
                  {!runtime && <FeaturesEditor conf={loaded.conf} board={loaded.board} edits={confEdits} setEdits={setConfEdits} />}
                  {loaded.board && (
                    <SoftOffCard
                      kb={kb}
                      board={loaded.board}
                      keymap={movedKeymap ?? loaded.keymap}
                      doc={doc}
                      setDoc={setDoc}
                      wake={wakeNow ?? loaded.board.wake}
                      setWake={setWakeNow}
                      liveLabels={liveLabels}
                    />
                  )}
                  {runtime ? <TapHoldSettings doc={doc} setDoc={setDoc} /> : <>
                  <h3 className="ry-h2" style={{ marginTop: 8 }}>{t("Behavior options", "동작 옵션")}</h3>
                  <SettingsEditor doc={doc} setDoc={setDoc} kb={kb} skip={loaded.board ? ["soft_off"] : []} /></>}
                </>
              )}

              {section !== "settings" && (
                <button className="ry-ghost ry-add" onClick={() => add(section)}>
                  <Plus /> {SECTIONS.find((s) => s.id === section)!.one()}
                </button>
              )}
            </div>
          )}

          <div className="ry-savebar">
            {/* shown next to the button that caused it, not at the top of a long page */}
            {saveError && dirty && <p className="ry-note ry-danger" role="alert">{t("Couldn't save: {e}", "저장하지 못했어요: {e}", { e: saveError })}</p>}
            {(saved === "runtime" || saved === "preview") && !dirty && <p className="ry-note">
              {saved === "preview" ? t("Preview saved in this browser.", "미리보기를 이 브라우저에 저장했습니다.") : t("Saved to the keyboard. No firmware rebuild was requested.", "키보드에 저장했습니다. 펌웨어 재빌드는 요청하지 않았습니다.")}
            </p>}
            {issues.length > 0 && (
              <ul className="ry-issues">
                {issues.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {saved && saved !== "runtime" && saved !== "preview" && !dirty && (
              <p className="ry-note">
                {L(
                  <>
                    Saved to {kb.branch}. GitHub is building the firmware now — check{" "}
                    <a className="ry-link" href={links(kb).builds} target="_blank" rel="noreferrer">
                      the build
                    </a>
                    , then update the keyboard from Firmware.{" "}
                  </>,
                  <>
                    {kb.branch}에 저장했어요. GitHub가 지금 펌웨어를 빌드하고 있어요 —{" "}
                    <a className="ry-link" href={links(kb).builds} target="_blank" rel="noreferrer">
                      빌드
                    </a>
                    가 끝나면 펌웨어 탭에서 키보드를 업데이트하세요.{" "}
                  </>
                )}
                <a className="ry-link" href={saved} target="_blank" rel="noreferrer">
                  {t("View commit", "커밋 보기")}
                </a>
              </p>
            )}
            <div className="ry-row">
              <span className="ry-faint ry-status">
                <span className={`ry-dot ${dirty ? "is-busy-still" : "is-ok"}`} aria-hidden="true" />
                {dirty ? t("Unsaved changes", "저장 안 된 변경") : t("All saved", "모두 저장됨")}
                {!runtime && loaded && !hasInclude(loaded.keymap)
                  ? t(" · The first save also adds one #include line to the keymap.", " · 처음 저장할 때 키맵에 #include 한 줄이 추가돼요.")
                  : ""}
              </span>
              <div className="ry-gap">
                {dirty && (
                  <button
                    className="ry-text"
                    onClick={() => {
                      localStorage.removeItem(draftKey);
                      setDoc(JSON.parse(loaded.savedJson));
                      setMovedKeymap(null);
                      setConfEdits({});
                      setWakeNow(null);
                    }}
                  >
                    {t("Discard", "변경 취소")}
                  </button>
                )}
                <button className="ry-primary" disabled={!dirty || issues.length > 0 || saving || (!!runtimeConn && runtimeLock !== LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED)} onClick={save}>
                  {saving ? t("Saving…", "저장 중…") : runtime ? (preview ? t("Save preview", "미리보기 저장") : t("Save to keyboard", "키보드에 저장")) : t("Save & build firmware", "저장하고 펌웨어 빌드")}
                </button>
              </div>
            </div>
          </div>
        </fieldset>
      )}
    </div>
  );
};

// ---------- pieces ----------

/** Soft Off in one place: which key, how long to hold it, and the key that wakes the keyboard again. */
const SoftOffCard = ({
  kb,
  board,
  keymap,
  doc,
  setDoc,
  wake,
  setWake,
  liveLabels,
}: {
  kb: Board;
  board: PowerDoc;
  keymap: string;
  doc: BehaviorDoc;
  setDoc: React.Dispatch<React.SetStateAction<BehaviorDoc>>;
  wake: number;
  setWake: (n: number) => void;
  liveLabels: KeyLabel[] | null;
}) => {
  const off = keysAt(keymap, findInKeymap(keymap, "&soft_off"));
  const hold = (doc.settings ?? []).find((s) => s.behavior === "soft_off")?.props["hold-time-ms"];
  const setHold = (v: number | null) =>
    setDoc((d) => {
      const list = (d.settings ?? []).filter((s) => s.behavior !== "soft_off");
      const prev = (d.settings ?? []).find((s) => s.behavior === "soft_off")?.props ?? {};
      const props = { ...prev };
      if (v === null) delete props["hold-time-ms"];
      else props["hold-time-ms"] = v;
      return { ...d, settings: Object.keys(props).length ? [{ behavior: "soft_off", props }, ...list] : list };
    });
  const wakeName = baseKeyName(keymap, wake);
  // the keys as they sit on the board, for the pictures: off = the Soft Off keys, on = wake key + the Soft Off key
  const layout = LAYOUTS[kb.layout || "60-ansi"];
  const offPos = positionsAt(keymap, findInKeymap(keymap, "&soft_off"));
  const geoOf = (ps: number[], names: string[]) => (layout && ps.every((p) => layout[p]) ? ps.map((p, i) => ({ label: names[i], x: layout[p][0], y: layout[p][1], w: layout[p][2] })) : null);
  const offGeo = off && offPos ? geoOf(offPos, off) : null;
  const onPos = offPos ? [wake, offPos[offPos.length - 1]] : null;
  const onGeo = onPos && off && (onPos[0] !== offPos![0] || onPos.length !== offPos!.length) ? geoOf(onPos, [wakeName, off[off.length - 1]]) : null;
  const offKey = off ? off.join(" + ") : null;
  const secs = typeof hold === "number" ? hold / 1000 : null;
  return (
    <article className="ry-card ry-item is-open">
      <div className="ry-card-t" style={{ padding: "14px 16px 4px" }}>Soft Off</div>
      <p className="ry-faint" style={{ padding: "0 16px 10px", margin: 0, lineHeight: 1.6 }}>
        {offKey
          ? t(
              "Off: hold {k}{s}, then let go. On: hold {w} + {last} for 3 s.",
              "끄기: {k}{s} 누르고 있다가 떼기 · 켜기: {w} + {last} 3초",
              { k: offKey, s: secs ? t(" for {n} s", " {n}초", { n: secs }) : "", w: wakeName, last: off![off!.length - 1] }
            )
          : t("Put Soft Off on a key in the editor.", "편집기에서 키에 Soft Off를 넣으세요.")}
      </p>
      <div className="ry-item-body">
        {offGeo && (
          <div className="ry-anim-pair">
            <figure>
              <KeyPress keys={offGeo} mode="long" seconds={secs ?? 3} />
              <figcaption>{onGeo ? t("Off", "끄기") : t("Off, and on again (same keys)", "끄기 · 다시 켜기 (같은 키)")}</figcaption>
            </figure>
            {onGeo && (
              <figure>
                <KeyPress keys={onGeo} mode="long" seconds={3} />
                <figcaption>{t("On", "켜기")}</figcaption>
              </figure>
            )}
          </div>
        )}
        <Field label="hold-time-ms" hint={t("How long to hold before it turns off.", "이 시간만큼 누르고 있다가 떼면 꺼져요.")}>
          <input
            type="number"
            className="ry-num"
            min={0}
            max={10000}
            placeholder={t("Default", "기본값")}
            value={hold === undefined ? "" : String(hold)}
            onChange={(e) => setHold(e.target.value === "" ? null : Math.max(0, Math.min(10000, Number(e.target.value) || 0)))}
          />
        </Field>
        <WakePicker
          b={kb}
          power={board}
          labels={liveLabels ?? baseLabels(keymap)}
          fromKeyboard={!!liveLabels}
          offAt={[...new Set(findInKeymap(keymap, "&soft_off").map((x) => x.pos))]}
          offWith={off && off.length > 1 ? off[0] : null}
          value={wake}
          onChange={setWake}
        />
      </div>
    </article>
  );
};

/** On/off firmware features (config/<board>.conf). */
export const FeaturesEditor = ({
  conf,
  board,
  edits,
  setEdits,
}: {
  conf: string;
  board: PowerDoc | null;
  edits: Record<string, string | null>;
  setEdits: React.Dispatch<React.SetStateAction<Record<string, string | null>>>;
}) => {
  const set = parseConf(conf);
  const value = (n: string): string | undefined => (n in edits ? edits[n] ?? undefined : set[n]);
  const fallback = (f: Feature) => board?.defaults?.[f.name] ?? (typeof f.def === "number" ? String(f.def) : f.def ? "y" : "n");
  const on = (f: Feature) => isOn(value(f.name) ?? fallback(f));
  const change = (name: string, v: string | null) =>
    setEdits((e) => {
      const next = { ...e };
      const saved = set[name] ?? null;
      if (v === saved) delete next[name];
      else next[name] = v;
      return next;
    });
  // switches tied to a feature move with it (see Feature.linked); a value equal to the default is no line
  const put = (n: string, v: "y" | "n") => change(n, v === (board?.defaults?.[n] ?? "n") ? null : v); // ZMK's own default for these is off
  const moveLinked = (f: Feature, nowOn: boolean) => {
    for (const n of f.linked?.follow ?? []) put(n, nowOn ? "y" : "n");
    if (nowOn) for (const n of f.linked?.need ?? []) if (value(n) === "n") change(n, null); // ZMK's default is on
  };
  const shown = FEATURES.filter((f) => (!f.hw || !board?.hardware || board.hardware.includes(f.hw)) && (!f.needs || on(FEATURES.find((x) => x.name === f.needs)!)));
  const sleepMin = Math.round(Number(value(SLEEP_TIMEOUT) ?? board?.defaults?.[SLEEP_TIMEOUT] ?? 900000) / 60000);
  return (
    <article className="ry-card ry-item is-open">
      <div className="ry-card-t" style={{ padding: "14px 16px 4px" }}>{t("Firmware features", "펌웨어 기능")}</div>
      <p className="ry-faint" style={{ padding: "0 16px 10px", margin: 0 }}>
        {t(
          "Applied after a firmware update. “Changed” marks what differs from how the board ships.",
          "펌웨어를 업데이트하면 적용돼요. ‘변경됨’은 보드 기본 설정과 다르게 바꾼 항목이에요."
        )}
      </p>
      <div className="ry-item-body" style={{ gap: 4 }}>
        {shown.map((f) => {
          if (f.range) {
            // a number (e.g. brightness): a slider and the value, typed or dragged
            const r = f.range;
            const cur = Number(value(f.name) ?? fallback(f));
            const changed = value(f.name) !== undefined && cur !== Number(fallback(f));
            const put = (n: number) => {
              const v = String(Math.max(r.min, Math.min(r.max, Math.round(n))));
              change(f.name, v === fallback(f) ? null : v);
            };
            return (
              <div key={f.name} className="ry-feature ry-feature-range">
                <span className="ry-feature-l">
                  {f.label()}
                  {changed && (
                    <span className="ry-changed">
                      <span className="ry-dot is-busy-still" aria-hidden="true" />
                      {t("Changed", "변경됨")}
                    </span>
                  )}
                  {f.hint && <span className="ry-faint" style={{ display: "block" }}>{f.hint()}</span>}
                </span>
                <span className="ry-range">
                  <input type="range" min={r.min} max={r.max} step={5} value={cur} onChange={(e) => put(Number(e.target.value))} aria-label={f.label()} style={{ ["--p" as string]: `${((cur - r.min) / (r.max - r.min)) * 100}%` }} />
                  <span className="ry-range-n">
                    <input type="number" className="ry-num" min={r.min} max={r.max} value={cur} onChange={(e) => put(Number(e.target.value))} aria-label={f.label()} />
                    <span className="ry-faint">{r.unit}</span>
                  </span>
                  {changed && (
                    <button className="ry-text" style={{ minHeight: 28, fontSize: 12 }} onClick={() => change(f.name, null)}>
                      {t("Reset", "되돌리기")}
                    </button>
                  )}
                </span>
              </div>
            );
          }
          // changed = differs from how the board ships (a line equal to the default changes nothing)
          const changed = value(f.name) !== undefined && on(f) !== isOn(fallback(f));
          return (
            <div key={f.name} className={`ry-feature${f.needs ? " is-sub" : ""}`}>
              <label className="ry-check">
                <input type="checkbox" checked={on(f)} onChange={(e) => {
                    // back to how the board ships = no line in the config
                    const v = e.target.checked ? "y" : "n";
                    change(f.name, v === (isOn(fallback(f)) ? "y" : "n") ? null : v);
                    moveLinked(f, e.target.checked);
                  }} />
                <span>
                  {f.label()}
                  {changed && (
                    <span className="ry-changed">
                      <span className="ry-dot is-busy-still" aria-hidden="true" />
                      {t("Changed", "변경됨")}
                    </span>
                  )}
                  {f.hint && <span className="ry-faint" style={{ display: "block" }}>{f.hint()}</span>}
                </span>
              </label>
              {changed && (
                <button className="ry-text" style={{ minHeight: 28, fontSize: 12 }} onClick={() => { change(f.name, null); moveLinked(f, isOn(fallback(f))); }}>
                  {t("Reset", "되돌리기")}
                </button>
              )}
              {/* already in the file the wrong way round (e.g. underglow on, its power switch off): offer to fix */}
              {on(f) && (f.linked?.follow ?? []).some((n) => !isOn(value(n) ?? board?.defaults?.[n])) && (
                <span className="ry-gap ry-feature-warn">
                  <span className="ry-faint">
                    <span className="ry-dot is-busy-still" aria-hidden="true" style={{ marginRight: 6 }} />
                    {t("Its power switch (EXT_POWER) is off, so the LEDs may still draw power when dark.", "전원 스위치(EXT_POWER)가 꺼져 있어서, 불이 꺼져도 LED가 전력을 쓸 수 있어요.")}
                  </span>
                  <button className="ry-text" style={{ minHeight: 28, fontSize: 12 }} onClick={() => moveLinked(f, true)}>
                    {t("Turn it on", "켜기")}
                  </button>
                </span>
              )}
              {f.name === "ZMK_SLEEP" && on(f) && (
                <span className="ry-gap" style={{ paddingLeft: 26 }}>
                  <span className="ry-faint">{t("after", "안 쓴 지")}</span>
                  <input
                    type="number"
                    className="ry-num"
                    min={1}
                    max={240}
                    value={sleepMin}
                    onChange={(e) => change(SLEEP_TIMEOUT, String(Math.max(1, Math.min(240, Number(e.target.value) || 15)) * 60000))}
                  />
                  <span className="ry-faint">{t("minutes", "분 뒤")}</span>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </article>
  );
};

/** One card per behavior; a value appears in the firmware only when a box is filled in. */
const SettingsEditor = ({ doc, setDoc, kb, skip = [] }: { doc: BehaviorDoc; setDoc: React.Dispatch<React.SetStateAction<BehaviorDoc>>; kb: Board; skip?: string[] }) => {
  const settings = doc.settings ?? [];
  const set = (behavior: string, prop: string, v: number | string | null) =>
    setDoc((d) => {
      const list = [...(d.settings ?? [])];
      const i = list.findIndex((x) => x.behavior === behavior);
      const props = { ...(i >= 0 ? list[i].props : {}) };
      if (v === null || v === "") delete props[prop];
      else props[prop] = v;
      if (i >= 0) list.splice(i, 1);
      if (Object.keys(props).length) list.push({ behavior, props });
      list.sort((a, b) => Object.keys(SETTING_SPECS).indexOf(a.behavior) - Object.keys(SETTING_SPECS).indexOf(b.behavior));
      return { ...d, settings: list };
    });
  return (
    <>
      {Object.entries(SETTING_SPECS).filter(([behavior]) => !skip.includes(behavior)).map(([behavior, spec]) => {
        const cur = settings.find((x) => x.behavior === behavior)?.props ?? {};
        return (
          <article key={behavior} className="ry-card ry-item is-open">
            <div className="ry-card-t" style={{ padding: "14px 16px 12px" }}>{spec.name()}</div>
            <div className="ry-item-body">
              {behavior === "soft_off" && kb.powerKey && (
                <p className="ry-note" style={{ margin: 0 }}>
                  {t("{k} turns off and on with {p}.", "{k}의 전원 끄기·켜기: {p}", { k: kb.name, p: kb.powerKey })}
                </p>
              )}
              {(behavior === "mt" || behavior === "lt") && (
                <BehaviorLab lab={{ kind: "holdTap",
                  term: Number(cur["tapping-term-ms"] ?? spec.props["tapping-term-ms"]?.def ?? 200),
                  quickTap: Number(cur["quick-tap-ms"] ?? spec.props["quick-tap-ms"]?.def ?? 0),
                  flavor: String(cur.flavor ?? spec.props.flavor?.def ?? "hold-preferred"),
                  tapLabel: behavior === "mt" ? "F" : "Space", holdLabel: behavior === "mt" ? "Shift" : t("Layer 1", "레이어 1") }} />
              )}
              {Object.entries(spec.props).map(([prop, ps]) => (
                <Field key={prop} label={ps.label()} hint={ps.hint?.()}>
                  {ps.options ? (
                    <select value={String(cur[prop] ?? "")} onChange={(e) => set(behavior, prop, e.target.value || null)}>
                      <option value="">{t("Default ({d})", "기본값 ({d})", { d: String(ps.def) })}</option>
                      {ps.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="number"
                      className="ry-num"
                      min={ps.min}
                      max={ps.max}
                      placeholder={t("Default", "기본값")}
                      value={cur[prop] === undefined ? "" : String(cur[prop])}
                      onChange={(e) => set(behavior, prop, e.target.value === "" ? null : Math.max(ps.min ?? 0, Math.min(ps.max ?? 1e6, Number(e.target.value) || 0)))}
                    />
                  )}
                </Field>
              ))}
            </div>
          </article>
        );
      })}
    </>
  );
};

const Item = ({
  title,
  summary,
  open,
  onToggle,
  onDelete,
  onCopy,
  keep,
  children,
}: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onCopy: () => void;
  /** a protected item: no copy/delete buttons, a "Required" mark instead (deleting stays possible from inside) */
  keep?: string;
  children: React.ReactNode;
}) => (
  <article className={`ry-card ry-item ${open ? "is-open" : ""}`}>
    <div className="ry-row">
      <button className="ry-item-head" onClick={onToggle} aria-expanded={open}>
        {open ? <ChevronDown /> : <ChevronRight />}
        <span>
          <span className="ry-card-t">{title || t("Untitled", "이름 없음")}</span>
          <span className="ry-card-m">{summary}</span>
        </span>
      </button>
      <span className="ry-gap" style={{ gap: 2 }}>
        {keep ? (
          <span className="ry-keep" title={keep}>
            <Lock aria-hidden="true" />
            {t("Required", "필수")}
          </span>
        ) : (
          <>
            <button className="ry-icon" title={t("Duplicate", "복사")} aria-label={t("Duplicate {n}", "{n} 복사", { n: title })} onClick={onCopy}>
              <Copy />
            </button>
            <button className="ry-icon trash" title={t("Delete", "삭제")} aria-label={t("Delete {n}", "{n} 삭제", { n: title })} onClick={onDelete}>
              <Trash2 />
            </button>
          </>
        )}
      </span>
    </div>
    {open && (
      <div className="ry-item-body">
        {keep && <p className="ry-keep-note">{keep}</p>}
        {children}
        {keep && (
          <div>
            <button className="ry-text ry-keep-delete" onClick={onDelete}>
              {t("Delete anyway…", "그래도 삭제…")}
            </button>
          </div>
        )}
      </div>
    )}
  </article>
);

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <div className="ry-field">
    <span className="ry-label">{label}</span>
    {children}
    {hint && <span className="ry-faint">{hint}</span>}
  </div>
);

const Num = ({ value, onChange, min, max }: { value: number; onChange: (n: number) => void; min: number; max: number }) => (
  <input
    type="number"
    className="ry-num"
    value={value}
    min={min}
    max={max}
    onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
  />
);

const ComboKeys = ({ keys, value, onChange }: { keys: KeyRect[]; value: number[]; onChange: (v: number[]) => void }) => {
  const w = Math.max(...keys.map(([x, , kw]) => x + kw), 100);
  const h = Math.max(...keys.map(([, y, , kh]) => y + kh), 100);
  const MAX = 4; // runtime combos allow up to four keys
  const full = value.length >= MAX;
  return (
    <div className="ry-combopick">
      {/* the chosen keys, each removable on its own */}
      <div className="ry-combo-chosen" aria-live="polite">
        {value.length ? value.map((p, n) => (
          <span key={p} className="ry-combo-chip">
            {n > 0 && <b className="ry-eq-op" aria-hidden="true">+</b>}
            <span className="ry-combo-chipcap">{keys[p]?.[4] ?? p}
              <button type="button" aria-label={t("Remove {k}", "{k} 빼기", { k: keys[p]?.[4] ?? String(p) })} onClick={() => onChange(value.filter((x) => x !== p))}>×</button>
            </span>
          </span>
        )) : <span className="ry-faint">{t("Click keys below to add them.", "아래 키보드에서 함께 누를 키를 눌러 추가하세요.")}</span>}
        {value.length > 0 && <button type="button" className="ry-text" onClick={() => onChange([])}>{t("Clear all", "모두 지우기")}</button>}
      </div>
      <p className="ry-faint" style={{ margin: 0 }}>{full ? t("Up to {n} keys. Remove one to choose another.", "최대 {n}개까지예요. 하나를 빼면 다른 키를 고를 수 있어요.", { n: MAX })
        : t("Click a chosen key again to remove it.", "선택한 키를 다시 누르면 빠져요.")}</p>
      <div className="ry-combokeys" style={{ aspectRatio: `${w} / ${h}` }}>
        {keys.map(([x, y, kw, kh, label], i) => {
          const on = value.includes(i);
          return (
            <button
              key={i}
              type="button"
              aria-pressed={on}
              disabled={!on && full}
              title={t("Position {i}", "위치 {i}", { i })}
              style={{ left: `${(x / w) * 100}%`, top: `${(y / h) * 100}%`, width: `${(kw / w) * 100}%`, height: `${(kh / h) * 100}%` }}
              onClick={() => onChange(on ? value.filter((p) => p !== i) : [...value, i])}
            >
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const STEP_KINDS: MacroStep["t"][] = ["text", "tap", "press", "release", "wait"];
const stepLabel = (k: MacroStep["t"]) =>
  ({
    text: t("Type", "글자 입력"),
    tap: "Tap",
    press: "Press",
    release: "Release",
    wait: "Wait",
  })[k];

const MacroSteps = ({
  macro,
  doc,
  layers,
  onChange,
}: {
  macro: Macro;
  doc: BehaviorDoc;
  layers: string[];
  onChange: (s: MacroStep[]) => void;
}) => {
  const steps = macro.steps;
  const set = (i: number, s: MacroStep) => onChange(steps.map((x, j) => (j === i ? s : x)));
  const move = (i: number, d: number) => {
    const n = [...steps];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    onChange(n);
  };
  const make = (t: MacroStep["t"]): MacroStep =>
    t === "text" ? { t, text: "" } : t === "wait" ? { t, ms: 100 } : { t, binding: defaultBinding("kp") };

  return (
    <div className="ry-steps-ed">
      {steps.map((s, i) => (
        <div key={i} className="ry-step">
          <select aria-label={t("Step type", "단계 종류")} className="ry-step-type" value={s.t} onChange={(e) => set(i, make(e.target.value as MacroStep["t"]))}>
            {STEP_KINDS.map((k) => (
              <option key={k} value={k}>
                {stepLabel(k)}
              </option>
            ))}
          </select>
          <div className="ry-step-body">
            {s.t === "text" && (
              <input type="text" placeholder={t("Text to type (English letters, numbers, symbols)", "입력할 글자 (영문, 숫자, 기호)")} value={s.text} onChange={(e) => set(i, { ...s, text: e.target.value })} />
            )}
            {s.t === "wait" && (
              <div className="ry-gap">
                <Num value={s.ms} min={1} max={10000} onChange={(ms) => set(i, { ...s, ms })} />
                <span className="ry-faint">ms</span>
              </div>
            )}
            {(s.t === "tap" || s.t === "press" || s.t === "release") && (
              <BindingPicker value={s.binding} doc={doc} layerNames={layers} exclude={macro.id} onChange={(binding) => set(i, { ...s, binding })} />
            )}
          </div>
          <div className="ry-step-tools">
            <button className="ry-icon" aria-label={t("Move up", "위로")} disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp />
            </button>
            <button className="ry-icon" aria-label={t("Move down", "아래로")} disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown />
            </button>
            <button className="ry-icon trash" aria-label={t("Remove step", "단계 삭제")} onClick={() => onChange(steps.filter((_, j) => j !== i))}>
              <Trash2 />
            </button>
          </div>
        </div>
      ))}
      <div className="ry-gap">
        {STEP_KINDS.map((k) => (
          <button key={k} className="ry-ghost" onClick={() => onChange([...steps, make(k)])}>
            <Plus /> {stepLabel(k)}
          </button>
        ))}
      </div>
      <p className="ry-faint">
        {t("For ⌘⇧4: “Tap” key 4 with Shift + GUI on.", "⌘⇧4 같은 단축키는 “탭”에서 4를 고르고 Shift와 GUI를 켜세요.")}
      </p>
    </div>
  );
};

