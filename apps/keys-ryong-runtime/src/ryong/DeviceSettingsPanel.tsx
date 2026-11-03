// "Keyboard settings": lights and deep sleep stored on the keyboard itself (no firmware rebuild).
// Each feature has its own "use" switch; the rest of its options only matter while it is on.
import { useContext, useEffect, useRef, useState } from "react";
import { ConnectionContext } from "../rpc/ConnectionContext";
import { LockStateContext } from "../rpc/LockStateContext";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import { firmwareDevice } from "./runtime/updateDevice";
import { connectDeviceSettings, DeviceSettings, DeviceSettingsClient, DeviceState } from "./runtime/deviceSettings";
import type { Light } from "./runtime/proto/settings";
import { t } from "./i18n";

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="ry-switch" disabled={disabled} onClick={() => onChange(!on)}><span /></button>;
}

const Row = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) =>
  <div className="ry-setrow"><div><div className="ry-setrow-t">{title}</div>{hint && <div className="ry-faint">{hint}</div>}</div><div className="ry-setrow-c">{children}</div></div>;

const SLEEP_PRESETS = [5, 10, 15, 30, 60];

/* The slot light's signals, each switchable (stored as "hide_*": absent = shown). */
const SIGNALS: [ "hideConnected" | "hideWaiting" | "hidePairing" | "hideCleared", () => string, () => string][] = [
  ["hideConnected", () => t("When connected", "연결되면"), () => t("On for 1 s when the slot's device connects. Switching often? Off saves battery.", "슬롯의 기기가 연결되면 1초 켜져요. 자주 전환한다면 꺼 두면 배터리가 아껴져요.")],
  ["hideWaiting", () => t("Waiting for its device", "등록된 기기 기다릴 때"), () => t("Slow blink up to 10 s after selecting a slot until its device connects.", "슬롯을 고른 뒤 그 기기가 연결될 때까지(최대 10초) 천천히 깜빡여요.")],
  ["hidePairing", () => t("Waiting for a new device", "새 기기 기다릴 때"), () => t("Fast blink up to 60 s while an empty slot waits to pair.", "빈 슬롯이 페어링을 기다리는 동안(최대 60초) 빠르게 깜빡여요.")],
  ["hideCleared", () => t("When a slot is cleared", "슬롯을 지우면"), () => t("One short flash (slot key held 3 s, Fn+D, or this page).", "한 번 짧게 깜빡여요 (슬롯 키 3초, Fn+D, 또는 이 페이지에서 삭제).")],
];

export function DeviceSettingsPanel() {
  const { conn } = useContext(ConnectionContext), lock = useContext(LockStateContext);
  const ready = !!conn && lock === LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED;
  const [dev, setDev] = useState<DeviceSettingsClient | null>(null);
  const [state, setState] = useState<DeviceState | null>(null);
  const [draft, setDraft] = useState<DeviceSettings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const [confirmDfu, setConfirmDfu] = useState(false), [dfuSent, setDfuSent] = useState(false);
  const [build, setBuild] = useState<string | null>(null);
  const at = useRef(conn); at.current = conn;
  const brtTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(brtTimer.current), [conn]);

  useEffect(() => {
    let cancelled = false;
    setDev(null); setState(null); setDraft(null); setLoaded(false); setError(null); setSaved(false);
    if (!ready || !conn) return;
    setBusy(true);
    (async () => {
      const d = await connectDeviceSettings(conn);
      const s = d ? await d.read() : null;
      if (!cancelled) { setDev(d); setState(s); setDraft(s?.settings ?? null); setLoaded(true); }
      // Which firmware build is on the keyboard (the code version shown in /admin), if it says.
      const fw = await firmwareDevice(conn).then((f) => f.identity()).catch(() => null);
      if (!cancelled) setBuild(fw?.buildId ?? null);
    })().catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [conn, ready, reload]);

  async function act(fn: () => Promise<DeviceState>) {
    const c = at.current;
    setBusy(true); setError(null); setSaved(false);
    try { const s = await fn(); if (at.current === c) { setState(s); return s; } }
    catch (e) { if (at.current === c) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (at.current === c) setBusy(false); }
  }

  const dirty = !!draft && !!state?.settings && JSON.stringify(draft) !== JSON.stringify(state.settings);
  const set = (patch: Partial<DeviceSettings>) => { setDraft((d) => d && { ...d, ...patch }); setSaved(false); };
  const setLight = (k: "backlight" | "underglow", patch: Partial<Light>) => setDraft((d) => d && { ...d, [k]: { ...d[k]!, ...patch } });

  // The brightness slider is applied (and stored) as soon as it is let go, on its own: a value that
  // only shows after pressing Save looked like the slider did nothing.
  async function applyBrightness(k: "backlight" | "underglow", brightness: number) {
    const base = state?.settings;
    if (!dev || !base || base[k]!.brightness === brightness) return;
    const s = await act(() => dev.save({ ...base, [k]: { ...base[k]!, brightness } }));
    if (s?.settings) setDraft((d) => d && { ...d, [k]: { ...d[k]!, brightness: s.settings![k]!.brightness } });
  }

  // The keyboard's own name: Bluetooth at once, USB from its next start. Stored on the keyboard.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const nameCard = () => {
    const current = state!.keyboardName, max = state!.keyboardNameMaxBytes;
    const value = nameDraft ?? current;
    const bytes = new TextEncoder().encode(value.trim()).length;
    const changed = value.trim() !== current && bytes > 0 && bytes <= max;
    return <section className="ry-card ry-setcard" aria-label={t("Keyboard name", "키보드 이름")}>
      <Row title={t("Keyboard name", "키보드 이름")} hint={t("Shown in Bluetooth lists with the slot number (e.g. “{n} 1”). Computers that already paired may keep the old name until paired again. The USB name stays the board's own.",
        "Bluetooth 목록에 슬롯 번호와 함께(예: “{n} 1”) 보여요. 이미 페어링한 컴퓨터는 다시 페어링할 때까지 예전 이름이 남을 수 있어요. USB 이름은 보드 이름 그대로예요.", { n: value.trim() || current })}>
        <span className="ry-gap">
          <input type="text" className="ry-input" value={value} aria-label={t("Keyboard name", "키보드 이름")} disabled={busy}
            onChange={(e) => setNameDraft(e.target.value)} style={{ width: "12em" }} />
          <button className="ry-primary" disabled={!changed || busy}
            onClick={async () => { const s = await act(() => dev!.rename(value)); if (s) setNameDraft(null); }}>{t("Rename", "이름 바꾸기")}</button>
        </span>
      </Row>
      {bytes > max && <p className="ry-note">{t("Too long: up to {m} bytes (English {m} letters, Korean {k}).", "너무 길어요: 최대 {m}바이트 (영문 {m}자, 한글 {k}자).", { m: max, k: Math.floor(max / 3) })}</p>}
    </section>;
  };

  // Bluetooth slot light: blinks on the backlight while a slot waits, flashes once when cleared.
  async function applyIndicatorBrightness(brightness: number) {
    const base = state?.settings;
    if (!dev || !base?.btIndicator || base.btIndicator.brightness === brightness) return;
    const s = await act(() => dev.save({ ...base, btIndicator: { ...base.btIndicator!, brightness } }));
    if (s?.settings?.btIndicator) setDraft((d) => d && { ...d, btIndicator: { ...d.btIndicator!, brightness: s.settings!.btIndicator!.brightness } });
  }
  const indicator = () => {
    const l = draft!.btIndicator!, savedUse = state!.settings!.btIndicator?.use;
    const name = t("Bluetooth slot light", "Bluetooth 슬롯 알림");
    const commit = (e: React.SyntheticEvent<HTMLInputElement>) => {
      const v = Number(e.currentTarget.value);
      clearTimeout(brtTimer.current);
      brtTimer.current = setTimeout(() => void applyIndicatorBrightness(v), 400);
    };
    return <section className="ry-card ry-setcard" aria-label={name}>
      <Row title={name} hint={t("Bluetooth slot status on the backlight. Choose which signals show below.", "Bluetooth 슬롯 상태를 백라이트로 알려요. 어떤 알림을 쓸지 아래에서 골라요.")}>
        <Switch on={l.use} label={t("Use {n}", "{n} 사용", { n: name })} onChange={(use) => setDraft((d) => d && { ...d, btIndicator: { ...d.btIndicator!, use } })} />
      </Row>
      {l.use && SIGNALS.map(([key, title, hint]) =>
        <Row key={key} title={title()} hint={hint()}>
          <Switch on={!l[key]} label={title()} onChange={(on) => setDraft((d) => d && { ...d, btIndicator: { ...d.btIndicator!, [key]: !on } })} />
        </Row>)}
      {l.use && <Row title={t("Light brightness", "알림 밝기")} hint={t("Applied when you let go, with one flash to show it. Low is easy on the eyes and the battery.", "슬라이더를 놓으면 바로 바뀌고 한 번 깜빡여 보여줘요. 낮을수록 눈과 배터리에 편해요.")}>
        <span className="ry-range"><input type="range" min={1} max={100} step={1} value={l.brightness} disabled={!savedUse}
          aria-label={t("Light brightness", "알림 밝기")} title={!savedUse ? t("Save first", "먼저 저장하세요") : undefined}
          onChange={(e) => setDraft((d) => d && { ...d, btIndicator: { ...d.btIndicator!, brightness: Number(e.target.value) } })}
          onPointerUp={commit} onKeyUp={commit} onBlur={commit} /><output>{l.brightness}%</output></span>
      </Row>}
    </section>;
  };

  const light = (k: "backlight" | "underglow") => {
    const l = draft![k]!, live = state!;
    const isOn = k === "backlight" ? live.backlightOn : live.underglowOn;
    const name = k === "backlight" ? t("Backlight", "백라이트") : t("RGB underglow", "RGB 언더글로우");
    const brtTitle = k === "backlight" ? t("Backlight brightness", "백라이트 밝기") : t("Underglow brightness", "언더글로우 밝기");
    const brtHint = k === "backlight"
      ? t("Applied when you let go. Brightness keys still work.", "슬라이더를 놓으면 바로 바뀌어요. 밝기 키로도 조절할 수 있어요.")
      : t("Applied when you let go; brightness keys can't go above it. About 50% is plenty on USB power.", "슬라이더를 놓으면 바로 바뀌고, 밝기 키로도 이 값보다 밝아지지 않아요. 50% 정도면 충분해요.");
    const usbTitle = k === "backlight" ? t("Backlight only on USB power", "백라이트: USB 연결 때만 켜기") : t("Underglow only on USB power", "언더글로우: USB 연결 때만 켜기");
    const usbHint = k === "backlight"
      ? t("The backlight goes dark on battery and comes back when plugged in. The underglow has its own switch.", "배터리로 쓸 때는 백라이트만 꺼지고, 케이블을 꽂으면 다시 켜져요. 언더글로우는 따로 정해요.")
      : t("The underglow goes dark on battery and comes back when plugged in. The backlight has its own switch.", "배터리로 쓸 때는 언더글로우만 꺼지고, 케이블을 꽂으면 다시 켜져요. 백라이트는 따로 정해요.");
    // a short pause first, so several arrow-key steps become one write
    const commit = (e: React.SyntheticEvent<HTMLInputElement>) => {
      const v = Number(e.currentTarget.value);
      clearTimeout(brtTimer.current);
      brtTimer.current = setTimeout(() => void applyBrightness(k, v), 400);
    };
    return <section className="ry-card ry-setcard" aria-label={name}>
      <Row title={name} hint={(k === "backlight" ? t("Lights under the keys.", "키 아래 조명이에요.") : t("Lights under the board. Off = its LED power is cut too.", "기판 아래 조명이에요. 끄면 LED 전원도 함께 꺼져요."))
        + " " + (isOn ? t("Now on.", "지금 켜져 있어요.") : t("Now off.", "지금 꺼져 있어요."))}>
        <Switch on={l.use} label={t("Use {n}", "{n} 사용", { n: name })} onChange={(use) => setLight(k, { use })} />
      </Row>
      {l.use && <>
        <Row title={t("On when the keyboard starts", "켤 때 켜기")}><Switch on={l.onAtStart} label={t("{n} on at start", "{n} 켤 때 켜기", { n: name })} onChange={(onAtStart) => setLight(k, { onAtStart })} /></Row>
        <Row title={brtTitle} hint={brtHint}>
          <span className="ry-range"><input type="range" min={5} max={100} step={5} value={l.brightness} disabled={!live.settings![k]!.use}
            aria-label={brtTitle} title={!live.settings![k]!.use ? t("Save first", "먼저 저장하세요") : undefined}
            onChange={(e) => setLight(k, { brightness: Number(e.target.value) })}
            onPointerUp={commit} onKeyUp={commit} onBlur={commit} /><output>{l.brightness}%</output></span>
        </Row>
        <Row title={usbTitle} hint={usbHint}>
          <Switch on={l.usbOnly} label={usbTitle} onChange={(usbOnly) => setLight(k, { usbOnly })} />
        </Row>
      </>}
    </section>;
  };

  return <div className="ry-beh">
    <div><h1 className="ry-h1">{t("Keyboard settings", "키보드 설정")}</h1>
      <p className="ry-lead">{t("Saved on the keyboard itself and applied right away — no firmware update.", "키보드에 바로 저장되고 곧바로 적용돼요. 펌웨어를 다시 올릴 필요가 없어요.")}</p>
      {build && <p className="ry-faint">{t("Firmware build {b}", "펌웨어 빌드 {b}", { b: build.slice(0, 7) })}</p>}
      {loaded && dev && <button className="ry-text" disabled={busy} onClick={() => setReload((x) => x + 1)}>{t("Reload from keyboard", "키보드에서 다시 읽기")}</button>}</div>
    {!ready && <p>{t("Connect and unlock the keyboard to change its settings.", "키보드를 연결하고 잠금을 풀면 설정을 바꿀 수 있어요.")}</p>}
    {error && <p role="alert" className="ry-note ry-danger">{error} <button className="ry-text" onClick={() => setReload((x) => x + 1)}>{t("Reload", "다시 읽기")}</button></p>}
    {busy && !loaded && <p role="status">{t("Reading the keyboard…", "키보드를 읽는 중…")}</p>}
    {loaded && !dev && <p>{t("This firmware keeps these settings in the firmware build. A newer Ryong firmware lets you change them here.", "이 펌웨어는 이 설정을 바꿀 수 없어요. 새 Ryong 펌웨어에서 여기서 바꿀 수 있어요.")}</p>}
    {draft && state && <>
      <section className="ry-card ry-setcard" aria-label={t("Deep sleep", "깊은 절전")}>
        <Row title={t("Deep sleep when idle", "안 쓰면 깊은 절전")} hint={t("Saves battery. Any key wakes it. Never while on USB power.", "배터리를 아껴요. 아무 키나 누르면 깨어나요. USB를 꽂았을 땐 절전하지 않아요.")}>
          <Switch on={draft.sleepEnabled} label={t("Deep sleep", "깊은 절전")} onChange={(sleepEnabled) => set({ sleepEnabled })} />
        </Row>
        {draft.sleepEnabled && <Row title={t("After", "절전까지")}>
          <span className="ry-chips">
            {SLEEP_PRESETS.map((m) => <button key={m} className="ry-chip" aria-pressed={draft.sleepMinutes === m} onClick={() => set({ sleepMinutes: m })}>{m < 60 ? t("{m} min", "{m}분", { m }) : t("1 h", "1시간")}</button>)}
            <span className="ry-num-unit"><input type="number" className="ry-num" min={1} max={state.caps!.sleepMaxMinutes || 1440} value={draft.sleepMinutes}
              aria-label={t("Minutes", "분")} onChange={(e) => set({ sleepMinutes: Math.max(1, Math.min(1440, Math.round(Number(e.target.value) || 1))) })} />{t("min", "분")}</span>
          </span>
        </Row>}
      </section>
      {state.keyboardNameMaxBytes > 0 && nameCard()}
      {state.caps!.backlight && light("backlight")}
      {state.caps!.underglow && light("underglow")}
      {state.caps!.btIndicator && draft.btIndicator && indicator()}
      {!state.caps!.backlight && !state.caps!.underglow && <p className="ry-faint">{t("This firmware has no lights built in.", "이 펌웨어에는 조명 기능이 없어요.")}</p>}
      {state.caps!.bleUpdate && <section className="ry-card ry-setcard" aria-label={t("Bluetooth update (development)", "Bluetooth 업데이트 (개발용)")}>
        <Row title={t("Bluetooth update mode (development)", "Bluetooth 업데이트 모드 (개발용)")}
          hint={t("Restarts into the bootloader. Send the build's -bluetooth.zip with the “nRF Device Firmware Update” app. If it fails, plug in USB and copy the .uf2.",
            "키보드가 부트로더로 다시 시작해요. 빌드의 -bluetooth.zip을 아이폰 “nRF Device Firmware Update” 앱으로 보내세요. 실패하면 USB로 연결해 .uf2를 복사하면 돼요.")}>
          {confirmDfu ? <span className="ry-gap">
            <button className="ry-text" onClick={() => setConfirmDfu(false)}>{t("Cancel", "취소")}</button>
            <button className="ry-primary" disabled={busy} onClick={async () => {
              setError(null);
              try { await dev!.bleUpdate(); setDfuSent(true); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
              setConfirmDfu(false);
            }}>{t("Restart now", "지금 다시 시작")}</button></span>
            : <button className="ry-outline" disabled={busy || dirty} onClick={() => setConfirmDfu(true)}>{t("Enter update mode", "업데이트 모드로")}</button>}
        </Row>
        {dfuSent && <p className="ry-note" role="status">{t("The keyboard is restarting into update mode. It appears as a DFU device in the app.", "키보드가 업데이트 모드로 다시 시작하고 있어요. 앱에서 DFU 장치로 보여요.")}</p>}
      </section>}
      <p className="ry-faint">{t("Some things are fixed when the firmware is built (N-key rollover, mouse keys, Bluetooth signal strength, asking to unlock before editing). They are set by the keyboard maker.",
        "N키 롤오버, 마우스 키, Bluetooth 신호 세기, 편집 전 잠금 해제 요구는 펌웨어를 만들 때 정해져요. 키보드 제작자가 정해요.")}</p>
      <div className="ry-savebar">
        {saved && !dirty && <p className="ry-note">{t("Saved to the keyboard.", "키보드에 저장했어요.")}</p>}
        <div className="ry-row">
          <span className="ry-faint ry-status"><span className={`ry-dot ${dirty ? "is-busy-still" : "is-ok"}`} aria-hidden="true" />{dirty ? t("Unsaved changes", "저장 안 된 변경") : t("All saved", "모두 저장됨")}</span>
          <div className="ry-gap">
            {dirty && <button className="ry-text" onClick={() => setDraft(state.settings!)}>{t("Discard", "변경 취소")}</button>}
            <button className="ry-primary" disabled={!dirty || busy} onClick={async () => { const s = await act(() => dev!.save(draft)); if (s) { setDraft(s.settings!); setSaved(true); } }}>
              {busy ? t("Saving…", "저장 중…") : t("Save to keyboard", "키보드에 저장")}</button>
          </div>
        </div>
      </div>
    </>}
  </div>;
}
