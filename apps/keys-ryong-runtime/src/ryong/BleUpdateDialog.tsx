// Wireless firmware install from this computer: the build's -bluetooth.zip is sent to a
// keyboard that is waiting for an update (Keyboard settings → "Wait for update"), over Web Bluetooth.
// Lives at the app level so it stays open while the keyboard restarts and its normal connection drops.
import {useContext, useEffect, useRef, useState} from "react";
import {X} from "lucide-react";
import {t} from "./i18n";
import {UpdateConnectionContext} from "./runtime/updateContext";
import {readBleDfuPackage, TARGET_NAMES, type BleDfuPackage} from "./runtime/webUpdate/bleDfuPackage";
import {connectWaitingKeyboard, sendApplication, webBluetoothAvailable, type BleDfuStage} from "./runtime/webUpdate/bleDfu";

export const OPEN_BLE_UPDATE = "ryong:open-ble-update";

const stageText = (s: BleDfuStage) => ({
  starting: t("Getting the keyboard ready (it clears the old firmware first)…", "키보드를 준비하는 중이에요(이전 펌웨어를 먼저 지워요)…"),
  init: t("Checking the new firmware…", "새 펌웨어를 확인하는 중…"),
  sending: t("Sending the firmware…", "펌웨어를 보내는 중…"),
  validating: t("The keyboard is checking what it received…", "키보드가 받은 펌웨어를 확인하는 중…"),
  activating: t("Starting the new firmware…", "새 펌웨어로 다시 켜는 중…"),
  done: t("Installed. The keyboard restarts with the new firmware; connect it again here.", "설치했어요. 키보드가 새 펌웨어로 다시 켜져요. 여기서 다시 연결해 주세요."),
})[s];

export function BleUpdateDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const {setUpdating} = useContext(UpdateConnectionContext);
  const [open, setOpen] = useState(false);
  const [pkg, setPkg] = useState<BleDfuPackage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<BleDfuStage | null>(null);
  const [sent, setSent] = useState<[number, number] | null>(null);
  const available = webBluetoothAvailable();

  useEffect(() => {
    const show = () => { setOpen(true); setError(null); setStage(null); setSent(null); };
    window.addEventListener(OPEN_BLE_UPDATE, show);
    return () => window.removeEventListener(OPEN_BLE_UPDATE, show);
  }, []);
  const wasOpen = useRef(false);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    // keep the "connect a keyboard" screen away while the keyboard restarts
    if (open !== wasOpen.current) setUpdating(open);
    wasOpen.current = open;
  }, [open, setUpdating]);
  useEffect(() => {
    if (!running) return;
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [running]);

  async function choose(file: File | undefined) {
    setPkg(null); setError(null); setStage(null); setSent(null);
    if (!file) return;
    try { setPkg(readBleDfuPackage(file.name, new Uint8Array(await file.arrayBuffer()))); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function install() {
    if (!pkg || running) return;
    setError(null); setStage(null); setSent(null); setRunning(true);
    let close = () => {};
    try {
      const k = await connectWaitingKeyboard(); // the browser's chooser: needs this click
      close = k.close;
      await sendApplication(pkg, k.link, (s, n, total) => { setStage(s); if (n !== undefined && total) setSent([n, total]); });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(/cancel/i.test(m) || (e as {name?: string})?.name === "NotFoundError"
        ? t("No keyboard was chosen. If none was listed, press “Wait for update” in Keyboard settings first.", "키보드를 고르지 않았어요. 목록에 없었다면 먼저 키보드 설정에서 “업데이트 대기로 켜기”를 눌러 주세요.")
        : m);
      setStage(null);
    } finally { close(); setRunning(false); }
  }

  const done = stage === "done";
  return <dialog ref={ref} className="ry-bledfu" onClose={() => { if (!running) setOpen(false); }} onCancel={(e) => { if (running) e.preventDefault(); }}
    aria-label={t("Wireless firmware install", "무선 펌웨어 설치")}>
    <div className="ry-bledfu-in">
      <div className="ry-row" style={{justifyContent: "space-between"}}>
        <h2 className="ry-card-t">{t("Wireless firmware install", "무선 펌웨어 설치")}</h2>
        <button className="ry-icon" disabled={running} onClick={() => setOpen(false)} aria-label={t("Close", "닫기")}><X /></button>
      </div>
      <p className="ry-note">{t("Only in Chromium browsers (Chrome, Edge, Whale, Opera…). Safari and Firefox can't reach Bluetooth devices from a web page.",
        "크로미움 계열 브라우저(크롬, 엣지, 웨일, 오페라 등)에서만 돼요. 사파리와 파이어폭스는 웹페이지가 Bluetooth 장치에 접근할 수 없어요.")}</p>
      {!available ? <p role="alert">{t("This browser can't do it. Open keys.ryong.com in Chrome or Edge.", "이 브라우저에서는 할 수 없어요. 크롬이나 엣지에서 keys.ryong.com을 열어 주세요.")}</p> : <>
        <ol className="ry-bledfu-steps">
          <li>{t("In Keyboard settings, press “Wait for update”. The keyboard restarts and waits for new firmware.", "키보드 설정에서 “업데이트 대기로 켜기”를 눌러요. 키보드가 새 펌웨어를 기다리는 상태로 다시 켜져요.")}</li>
          <li>{t("Choose the new firmware file (the build's file ending in -bluetooth.zip).", "새 펌웨어 파일을 골라요(빌드에서 받은, 이름이 -bluetooth.zip으로 끝나는 파일).")}
            <input type="file" accept=".zip,application/zip" disabled={running} onChange={(e) => void choose(e.target.files?.[0])} aria-label={t("Firmware file", "펌웨어 파일")} /></li>
          <li>{t("Press Install and pick the keyboard in the browser's list (geist shows as “Ryong60DFU”, the bootloader's fixed name; other boards as “AdaDFU”).", "“설치”를 누르고 브라우저 목록에서 키보드를 골라요(geist는 부트로더에 고정된 이름 “Ryong60DFU”로, 다른 보드는 “AdaDFU”로 보여요).")}</li>
        </ol>
        {pkg && <p className="ry-faint">{t("{f} · {kb} KB · for {b}", "{f} · {kb}KB · {b}용", {f: pkg.name, kb: Math.ceil(pkg.application.length / 1024), b: pkg.target ? TARGET_NAMES[pkg.target] : t("unknown board (check the file name)", "알 수 없는 보드(파일 이름 확인)")})}</p>}
        {pkg && <p className="ry-note">{t("Make sure this file is for this keyboard. A file for another board makes it stop working until the right .uf2 is copied over USB.",
          "이 키보드용 파일이 맞는지 확인해 주세요. 다른 보드용 파일을 넣으면 맞는 .uf2를 USB로 복사할 때까지 키보드가 동작하지 않아요.")}</p>}
        <button className="ry-primary" disabled={!pkg || running || done} onClick={() => void install()}>{running ? t("Installing…", "설치 중…") : t("Install", "설치")}</button>
        {running && <p role="status">{t("Keep this page open and the keyboard near the computer.", "이 페이지를 닫지 말고 키보드를 컴퓨터 가까이 두세요.")}</p>}
        {stage && <p aria-live="polite">{stageText(stage)}</p>}
        {stage === "sending" && sent && <progress max={sent[1]} value={sent[0]} aria-label={t("Firmware sent", "보낸 펌웨어")} />}
        {error && <p role="alert" className="ry-danger">{error} {t("The keyboard stays waiting for an update: try again, or connect USB and copy the .uf2 onto the drive that appears.",
          "키보드는 업데이트 대기 상태로 남아 있어요. 다시 시도하거나, USB로 연결해 나타나는 드라이브에 .uf2 파일을 복사하세요.")}</p>}
      </>}
    </div>
  </dialog>;
}
