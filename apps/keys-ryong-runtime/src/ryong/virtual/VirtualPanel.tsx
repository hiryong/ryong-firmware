import { useEffect, useState } from "react";
import { t } from "../i18n";
import { getVirtualDevice } from "./virtualKeyboard";
import * as O from "../runtime/proto/os_detection";

function useVirtual() {
  const [, tick] = useState(0);
  const device = getVirtualDevice();
  useEffect(() => device.subscribe(() => tick(n => n + 1)), [device]);
  return device;
}

/** Shown inside the unlock dialog: the dialog is modal, so this is the only reachable control. */
export function VirtualUnlockButton() {
  const v = useVirtual();
  if (!v.connected) return null;
  return <button className="ry-primary" onClick={() => v.setLock(false)}>
    {t("Virtual keyboard: press the unlock key", "가상 키보드: 잠금 해제 키 누르기")}</button>;
}

/** What a person would do with the physical keyboard, as buttons. Simulation only. */
export function VirtualPanel({ onDisconnect }: { onDisconnect: () => void }) {
  const v = useVirtual();
  const [open, setOpen] = useState(false);
  if (!v.connected) return null;
  const f = v.flash, active = f.slots[f.active];
  return <aside className="ry-virtual" aria-label={t("Virtual keyboard controls", "가상 키보드 조작")}>
    <button className="ry-virtual-head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
      <span className="ry-virtual-dot" aria-hidden="true" />{t("Virtual keyboard", "가상 키보드")}
      <span className="ry-faint">{v.locked ? t("locked", "잠김") : t("unlocked", "잠금 해제됨")}</span>
    </button>
    {open && <div className="ry-virtual-body">
      <p className="ry-faint">{t("A simulated Ryong60 in this browser. Saved changes stay in this browser only; nothing proves real firmware behaviour.",
        "이 브라우저 안의 가상 Ryong60입니다. 저장한 내용은 이 브라우저에만 남고, 실제 펌웨어 동작을 증명하지 않습니다.")}</p>
      <div className="ry-virtual-row">
        <button className="ry-chip" onClick={() => v.setLock(!v.locked)}>{v.locked ? t("Press unlock key", "잠금 해제 키") : t("Lock", "잠그기")}</button>
        <button className="ry-chip" onClick={() => v.reboot()}>{t("Unplug & replug", "껐다 켜기")}</button>
        <button className="ry-chip" aria-pressed={f.usb} onClick={() => v.setUsb(!f.usb)}>{f.usb ? t("USB cable: in", "USB 케이블: 꽂음") : t("USB cable: out", "USB 케이블: 뺌")}</button>
      </div>
      <p className="ry-faint" aria-live="polite">{t("Lights", "조명")}: {t("backlight", "백라이트")} {v.device.blOn ? "●" : "○"} · {t("underglow", "언더글로우")} {v.device.ugOn ? "●" : "○"}</p>
      <p className="ry-label">{t("Bluetooth (selected: slot {n})", "Bluetooth (선택: 슬롯 {n})", { n: f.active + 1 })}</p>
      <div className="ry-virtual-row">
        {f.slots.map((s, i) => <button key={i} className="ry-chip" aria-pressed={s.bonded && s.connected} disabled={!s.bonded}
          title={t("Toggle whether this host is in range", "이 기기가 근처에 있는지 전환")} onClick={() => v.toggleLink(i)}>
          {i + 1}{s.bonded ? (s.connected ? " ●" : " ○") : " –"}</button>)}
      </div>
      {!active.bonded && <div className="ry-virtual-row">
        <span className="ry-faint">{t("Pair a new host on the selected slot:", "선택한 빈 슬롯에 새 기기 페어링:")}</span>
        <button className="ry-chip" onClick={() => v.pairActive("mac" + Date.now(), O.Os.OS_MACOS)}>Mac</button>
        <button className="ry-chip" onClick={() => v.pairActive("win" + Date.now(), O.Os.OS_WINDOWS)}>Windows</button>
        <button className="ry-chip" onClick={() => v.pairActive("ios" + Date.now(), O.Os.OS_IOS)}>iPhone</button>
      </div>}
      <p className="ry-faint">{t("Changes made here are reflected after “Reload from keyboard”.", "여기서 바꾼 상태는 각 화면의 ‘다시 읽기’ 후 반영됩니다.")}</p>
      <div className="ry-virtual-row">
        <button className="ry-text" onClick={onDisconnect}>{t("Disconnect", "연결 끊기")}</button>
        <button className="ry-text ry-danger" onClick={() => { if (confirm(t("Reset the virtual keyboard to factory state?", "가상 키보드를 공장 상태로 되돌릴까요?"))) v.factoryReset(); }}>
          {t("Factory reset", "공장 초기화")}</button>
      </div>
    </div>}
  </aside>;
}
