// "Keyboard settings": lights and deep sleep stored on the keyboard itself (no firmware rebuild).
// Each feature has its own "use" switch; the rest of its options only matter while it is on.
import { useContext, useEffect, useRef, useState } from "react";
import { ConnectionContext } from "../rpc/ConnectionContext";
import { LockStateContext } from "../rpc/LockStateContext";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import { BACKLIGHT, connectDeviceSettings, DeviceSettings, DeviceSettingsClient, DeviceState, UNDERGLOW } from "./runtime/deviceSettings";
import type { Light } from "./runtime/proto/settings";
import { t } from "./i18n";

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="ry-switch" disabled={disabled} onClick={() => onChange(!on)}><span /></button>;
}

const Row = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) =>
  <div className="ry-setrow"><div><div className="ry-setrow-t">{title}</div>{hint && <div className="ry-faint">{hint}</div>}</div><div className="ry-setrow-c">{children}</div></div>;

const SLEEP_PRESETS = [5, 10, 15, 30, 60];

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
  const at = useRef(conn); at.current = conn;

  useEffect(() => {
    let cancelled = false;
    setDev(null); setState(null); setDraft(null); setLoaded(false); setError(null); setSaved(false);
    if (!ready || !conn) return;
    setBusy(true);
    (async () => {
      const d = await connectDeviceSettings(conn);
      const s = d ? await d.read() : null;
      if (!cancelled) { setDev(d); setState(s); setDraft(s?.settings ?? null); setLoaded(true); }
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

  const light = (k: "backlight" | "underglow") => {
    const l = draft![k]!, live = state!;
    const which = k === "backlight" ? BACKLIGHT : UNDERGLOW;
    const isOn = k === "backlight" ? live.backlightOn : live.underglowOn;
    const savedUse = live.settings![k]!.use, savedUsbOnly = live.settings![k]!.usbOnly;
    const name = k === "backlight" ? t("Backlight", "백라이트") : t("RGB underglow", "RGB 언더글로우");
    const blockedNow = !savedUse || (savedUsbOnly && !live.usbPowered);
    return <section className="ry-card ry-setcard" aria-label={name}>
      <Row title={name} hint={k === "backlight" ? t("Lights under the keys.", "키 아래 조명이에요.") : t("Lights under the board. Off = its LED power is cut too.", "기판 아래 조명이에요. 끄면 LED 전원도 함께 꺼져요.")}>
        <Switch on={l.use} label={t("Use {n}", "{n} 사용", { n: name })} onChange={(use) => setLight(k, { use })} />
      </Row>
      {l.use && <>
        <Row title={t("Right now", "지금 상태")} hint={isOn ? t("On", "켜짐") : t("Off", "꺼짐")}>
          <button className="ry-outline" disabled={busy || dirty || (!isOn && blockedNow)} title={dirty ? t("Save first", "먼저 저장하세요") : undefined}
            onClick={() => act(() => dev!.power(which, !isOn))}>{isOn ? t("Turn off", "끄기") : t("Turn on", "켜기")}</button>
        </Row>
        <Row title={t("On when the keyboard starts", "켤 때 켜기")}><Switch on={l.onAtStart} label={t("On at start", "켤 때 켜기")} onChange={(onAtStart) => setLight(k, { onAtStart })} /></Row>
        <Row title={k === "backlight" ? t("Brightness", "밝기") : t("Maximum brightness", "최대 밝기")}
          hint={k === "underglow" ? t("About 50% is plenty and keeps USB power in check.", "50% 정도면 충분하고 USB 전력도 여유가 생겨요.") : undefined}>
          <span className="ry-range"><input type="range" min={k === "backlight" ? 5 : 0} max={100} step={5} value={l.brightness}
            aria-label={k === "backlight" ? t("Brightness", "밝기") : t("Maximum brightness", "최대 밝기")}
            onChange={(e) => setLight(k, { brightness: Number(e.target.value) })} /><output>{l.brightness}%</output></span>
        </Row>
        <Row title={t("Only on USB power", "USB 연결 때만 켜기")} hint={t("Dark on battery, back on when plugged in.", "배터리로 쓸 때는 꺼지고, 케이블을 꽂으면 다시 켜져요.")}>
          <Switch on={l.usbOnly} label={t("Only on USB power", "USB 연결 때만 켜기")} onChange={(usbOnly) => setLight(k, { usbOnly })} />
        </Row>
      </>}
    </section>;
  };

  return <div className="ry-beh">
    <div><h1 className="ry-h1">{t("Keyboard settings", "키보드 설정")}</h1>
      <p className="ry-lead">{t("Saved on the keyboard itself and applied right away — no firmware update.", "키보드에 바로 저장되고 곧바로 적용돼요. 펌웨어를 다시 올릴 필요가 없어요.")}</p>
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
      {state.caps!.backlight && light("backlight")}
      {state.caps!.underglow && light("underglow")}
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
