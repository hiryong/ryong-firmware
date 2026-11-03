import { useContext, useEffect, useState, useRef } from "react";
import { ConnectionContext } from "../rpc/ConnectionContext";
import { LockStateContext } from "../rpc/LockStateContext";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import { connectHostDevice, HostDevice, Os } from "./runtime/hostDevice";
import { BleProfileDevice, connectBleProfiles, normalizeName } from "./runtime/bleProfiles";
import type { StateResponse, BleProfileState as O_BleProfileState } from "./runtime/proto/os_detection";
import type { State as SlotState } from "./runtime/proto/ble_profiles";
import { t } from "./i18n";

const apple = (os: Os) => os === Os.OS_MACOS || os === Os.OS_IOS;
const layout = (os: Os) => apple(os) ? t("Apple · Command / Option", "Apple · Command / Option") : t("Windows standard", "Windows 표준");
/** How the keyboard decided (firmware's last connection since power-up). */
const basisLabel = (f: NonNullable<O_BleProfileState["fingerprint"]>) =>
  f.appleProbe === 2 ? t("the Mac said so", "Mac이 직접 알려줌") : f.appleProbe === 3 ? t("the iPhone/iPad said so", "iPhone·iPad가 직접 알려줌")
  : f.appleProbe === 1 ? t("host says it is not Apple", "Apple 기기가 아니라고 알려줌") : t("guessed from how it connected", "연결 방식으로 추정");
const fingerprintText = (f: NonNullable<O_BleProfileState["fingerprint"]>) =>
  `HID map ${f.reportMap} · HID info ${f.hidsInfo} · report ${f.report} · PnP ${f.pnpId} · appearance ${f.appearance} · MTU ${f.attMtu} · interval ${f.connInterval} · probe ${f.appleProbe}${f.keptCached ? " · kept" : ""}`;
const detectedLabel = (os: Os) => os === Os.OS_UNKNOWN || os === Os.OS_UNSPECIFIED
  ? t("Not detected yet", "아직 감지 안 됨") : apple(os) ? t("Apple (macOS / iOS)", "Apple 계열 (macOS / iOS)") : t("Windows or other", "Windows 또는 기타");

/** Logitech Easy-Switch style manager. Shows only what this firmware reports it supports. */
export function HostPanel() {
  const { conn } = useContext(ConnectionContext), lock = useContext(LockStateContext);
  const [hostDev, setHostDev] = useState<HostDevice | null>(null), [host, setHost] = useState<StateResponse | null>(null);
  const [slotDev, setSlotDev] = useState<BleProfileDevice | null>(null), [slots, setSlots] = useState<SlotState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<number | null>(null), [draft, setDraft] = useState("");
  const [confirmClear, setConfirmClear] = useState<number | null>(null);
  const currentConn = useRef(conn); currentConn.current = conn;
  const [reload, setReload] = useState(0);
  const ready = !!conn && lock === LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED;

  useEffect(() => {
    let cancelled = false;
    setHost(null); setHostDev(null); setSlots(null); setSlotDev(null); setError(null); setLoaded(false); setEditing(null); setConfirmClear(null);
    if (!ready || !conn) return;
    setBusy(true);
    (async () => {
      // Each feature is optional; a firmware without one simply hides its controls.
      const s = await connectBleProfiles(conn);
      const slotState = s ? await s.read() : null;
      const h = await connectHostDevice(conn).catch(() => null);
      const hostState = h ? await h.read() : null;
      if (!cancelled) { setSlotDev(s); setSlots(slotState); setHostDev(h); setHost(hostState); setLoaded(true); }
    })().catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [conn, ready, reload]);

  async function act(fn: () => Promise<void>) {
    const at = currentConn.current;
    setBusy(true); setError(null);
    try { await fn(); }
    catch (e) { if (currentConn.current === at) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (currentConn.current === at) setBusy(false); }
  }
  const refreshHost = async () => { if (hostDev) setHost(await hostDev.read()); };

  const indices = slots ? slots.profiles.map(p => p.index) : host ? host.bleProfiles.map(p => p.index) : [];
  const nameError = (() => {
    if (editing === null || !slots) return null;
    try { normalizeName(draft, slots.nameMaxBytes); return null; }
    catch (e) {
      return e instanceof Error && e.message === "NAME_TOO_LONG"
        ? t("Too long (about {n} Korean or {m} English characters).", "너무 깁니다 (한글 약 {n}자, 영문 {m}자까지).", { n: Math.floor(slots.nameMaxBytes / 3), m: slots.nameMaxBytes })
        : t("Line breaks and control characters are not allowed.", "줄바꿈이나 제어 문자는 쓸 수 없습니다.");
    }
  })();

  return <div className="ry-beh">
    <div><h1 className="ry-h1">{t("Bluetooth devices", "Bluetooth 기기")}</h1>
      <p className="ry-lead">{t("Name each Bluetooth slot, switch between them and remove a registration. Apple hosts use Command / Option; others use Windows standard.",
        "슬롯마다 이름을 붙이고, 전환하고, 등록을 지울 수 있습니다. Apple 기기는 Command / Option, 나머지는 Windows 표준 배치를 씁니다.")}</p></div>
    <p className="ry-note">{t("Connection state and OS come from the keyboard. A device that is not connected is shown as last seen, not live. OS detection is a best-effort guess; a manual choice takes precedence.",
      "연결 상태와 OS는 키보드가 알려 주는 값입니다. 연결되지 않은 기기는 실시간 상태가 아니라 마지막으로 본 정보입니다. OS 자동 감지는 추정이며 수동 지정이 우선합니다.")}</p>
    {!ready && <p>{t("Connect and unlock the keyboard to manage its Bluetooth slots.", "키보드를 연결하고 잠금을 풀면 Bluetooth 슬롯을 관리할 수 있습니다.")}</p>}
    {error && <p role="alert" className="ry-note ry-danger">{error}</p>}
    {busy && <p role="status">{t("Talking to the keyboard…", "키보드와 통신하는 중…")}</p>}
    {loaded && !slots && !host && <p>{t("This firmware does not provide Bluetooth slot management.", "이 펌웨어는 Bluetooth 슬롯 관리를 지원하지 않습니다.")}</p>}
    {loaded && !slots && host && <p className="ry-faint">{t("This firmware supports OS layouts only. Names, switching and removal need a newer Ryong firmware.",
      "이 펌웨어는 OS 배치만 지원합니다. 이름·전환·삭제는 새 Ryong 펌웨어가 필요합니다.")}</p>}
    {host && <p>{t("Current layout", "현재 배치")} · <strong>{layout(host.currentEffective)}</strong>
      {host.usb?.connected && <span className="ry-faint"> · USB {t("connected", "연결됨")}: {detectedLabel(host.usb.detected)}</span>}</p>}

    {indices.map(index => {
      const slot = slots?.profiles.find(p => p.index === index);
      const os = host?.bleProfiles.find(p => p.index === index);
      const bonded = slot?.bonded ?? os?.bonded ?? false;
      const connected = slot?.connected ?? os?.connected ?? false;
      const active = (slots?.activeIndex ?? host?.activeProfileIndex) === index;
      const title = slot?.name || t("Bluetooth {n}", "Bluetooth {n}", { n: index + 1 });
      return <div className={"ry-card" + (bonded || active ? "" : " is-dim")} key={index} aria-label={t("Slot {n}", "슬롯 {n}", { n: index + 1 })}>
        <div className="ry-row">
          <div><div className="ry-card-t">{title}</div>
            <div className="ry-card-m">{slot?.name ? t("Slot {n}", "슬롯 {n}", { n: index + 1 }) + " · " : ""}
              {connected ? t("Connected", "연결됨") : bonded ? t("Registered · not connected", "등록됨 · 연결 안 됨") : t("Empty · ready to pair when selected", "비어 있음 · 선택하면 페어링 대기")}</div></div>
          <div className="ry-row" style={{ justifyContent: "flex-end" }}>
            {active ? <span className="ry-chip" aria-pressed="true" role="status">{t("Selected", "선택됨")}</span>
              : slots && <button className="ry-outline" disabled={busy} onClick={() => act(async () => { setSlots(await slotDev!.select(index, slots)); await refreshHost(); })}>
                  {t("Switch here", "이 슬롯으로 전환")}</button>}
          </div>
        </div>

        {editing === index && slots ? <form className="ry-row" onSubmit={e => { e.preventDefault(); if (nameError) return;
            act(async () => { setSlots(await slotDev!.rename(index, draft, slots)); setEditing(null); }); }}>
          <label className="ry-field" style={{ flex: "1 1 220px" }}><span className="ry-label">{t("Name", "이름")}</span>
            <input type="text" autoFocus value={draft} maxLength={64} placeholder={t("e.g. MacBook, Work PC, iPhone", "예: 맥북, 회사 PC, 아이폰")}
              aria-invalid={!!nameError} onChange={e => setDraft(e.target.value)} /></label>
          <button className="ry-primary" type="submit" disabled={busy || !!nameError}>{t("Save", "저장")}</button>
          <button className="ry-outline" type="button" onClick={() => setEditing(null)}>{t("Cancel", "취소")}</button>
          {nameError && <p className="ry-faint ry-danger" style={{ flexBasis: "100%" }}>{nameError}</p>}
        </form> : null}

        {os && bonded && <div className="ry-row">
          <span className="ry-faint">{t("Last detected", "마지막 감지")} · {detectedLabel(os.detected)}
            {os.fingerprint && <> · <span title={fingerprintText(os.fingerprint)}>{basisLabel(os.fingerprint)}</span></>}</span>
          <label className="ry-field"><span className="ry-label">{t("Key layout", "키 배치")}</span>
            <select value={os.override} disabled={busy || !hostDev} aria-label={t("Slot {n} layout", "슬롯 {n} 배치", { n: index + 1 })}
              onChange={e => { const next = Number(e.target.value) as Os; act(async () => { setHost(await hostDev!.setOverride(index, next, host!)); }); }}>
              <option value={Os.OS_UNKNOWN}>{t("Automatic", "자동")} · {layout(os.effective)}</option>
              <option value={Os.OS_WINDOWS}>{t("Windows standard", "Windows 표준")}</option>
              <option value={Os.OS_MACOS}>Apple</option>
              {![Os.OS_UNKNOWN, Os.OS_WINDOWS, Os.OS_MACOS].includes(os.override) && <option value={os.override}>{t("Existing custom choice", "기존 지정")}</option>}
            </select></label>
        </div>}

        {slots && bonded && editing !== index && confirmClear !== index && <div className="ry-row" style={{ justifyContent: "flex-start" }}>
          <button className="ry-text" disabled={busy} onClick={() => { setEditing(index); setDraft(slot?.name ?? ""); setConfirmClear(null); }}>
            {slot?.name ? t("Rename", "이름 변경") : t("Add name", "이름 붙이기")}</button>
          <button className="ry-text ry-danger" disabled={busy} onClick={() => { setConfirmClear(index); setEditing(null); }}>{t("Remove registration", "등록 삭제")}</button>
        </div>}

        {confirmClear === index && slots && <div className="ry-note ry-danger" role="alertdialog" aria-label={t("Remove registration", "등록 삭제")}>
          <p><strong>{t("Remove {name} from this keyboard?", "{name}의 등록을 키보드에서 지울까요?", { name: title })}</strong></p>
          <p>{t("This deletes the keyboard's pairing, the name and the OS setting for this slot. The computer or phone still lists the keyboard: remove it there too before pairing again.",
            "키보드에 저장된 이 슬롯의 페어링, 이름, OS 설정이 지워집니다. 상대 컴퓨터·휴대폰에는 키보드 등록이 그대로 남아 있으니, 다시 페어링하기 전에 그쪽에서도 지워 주세요.")}</p>
          {connected && <p>{t("It is connected now and will disconnect immediately.", "지금 연결되어 있어서 바로 끊어집니다.")}</p>}
          {active && <p>{t("This slot stays selected and waits for a new device.", "이 슬롯은 선택된 채로 새 기기를 기다립니다.")}</p>}
          <div className="ry-row" style={{ justifyContent: "flex-start" }}>
            <button className="ry-outline ry-danger" disabled={busy} onClick={() => act(async () => { setSlots(await slotDev!.clear(index, slots)); setConfirmClear(null); await refreshHost(); })}>
              {t("Remove", "지우기")}</button>
            <button className="ry-outline" onClick={() => setConfirmClear(null)}>{t("Keep", "그대로 두기")}</button>
          </div>
        </div>}
      </div>;
    })}
    {ready && <button className="ry-outline" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => setReload(n => n + 1)}>{t("Reload from keyboard", "키보드에서 다시 읽기")}</button>}
  </div>;
}
