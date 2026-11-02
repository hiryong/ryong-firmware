import {useEffect,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {t} from "./i18n";
type BootloaderInfo={board_id:string;info:string};
/** Read-only preflight while release approval is closed. Never reboots a keyboard. */
export function NativeUpdatePanel(){
 const [ready,setReady]=useState(false),[info,setInfo]=useState<BootloaderInfo[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const native=!!window.__TAURI_INTERNALS__;
 useEffect(()=>{if(native)invoke<{automatic_updates_ready:boolean}>("firmware_update_capabilities").then(r=>setReady(r.automatic_updates_ready)).catch(e=>setError(String(e)));},[native]);
 return <section className="ry-card">
  <h2 className="ry-card-t">{t("Firmware update","펌웨어 업데이트")}</h2>
  <p>{ready?t("A validated update path is available for supported models.","검증된 모델에 업데이트 경로가 준비되어 있습니다."):t("Automatic updates are being prepared for this development version.","이 개발 버전의 자동 업데이트를 준비하고 있습니다.")}</p>
  <p className="ry-note">{t("Updates will back up settings, verify the board and package, transfer with progress and confirm reconnection. Do not disconnect power while transferring.","업데이트는 설정 백업, 기기·파일 검증, 진행률을 표시하는 전송, 재연결 확인 순서로 진행합니다. 전송 중에는 전원을 분리하지 마세요.")}</p>
  {native&&<button className="ry-outline" disabled={busy} onClick={async()=>{setBusy(true);setError(null);try{setInfo(await invoke<BootloaderInfo[]>("firmware_bootloader_inventory"));}catch(e){setError(String(e));}finally{setBusy(false);}}}>{t("Read bootloader information","부트로더 정보 읽기")}</button>}
  {busy&&<p role="status">{t("Checking…","확인 중…")}</p>}
  {info.map((v,i)=><details key={i}><summary>{v.board_id}</summary><pre style={{whiteSpace:"pre-wrap"}}>{v.info}</pre></details>)}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
