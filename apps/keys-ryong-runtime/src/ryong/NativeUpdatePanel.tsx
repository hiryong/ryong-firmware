import {useContext,useEffect,useRef,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {ConnectionContext} from "../rpc/ConnectionContext";
import {LockStateContext} from "../rpc/LockStateContext";
import {LockState} from "@zmkfirmware/zmk-studio-ts-client/core";
import {firmwareDevice,FirmwareIdentity} from "./runtime/updateDevice";
import {FirmwareUpdateMachine,UpdateProgress} from "./runtime/updateMachine";
import {UpdateConnectionContext} from "./runtime/updateContext";
import {downloadText} from "./runtime/profileFile";
import {browserUpdatePorts,readUpdateBackup} from "./runtime/webUpdate/browserPorts";
import {APPROVED_WEB_DFU_POLICIES} from "./runtime/webUpdate/package";
import {t} from "./i18n";
type BootloaderInfo={board_id:string;info:string};
type Permission={filters:SerialPortFilter[];resolve:(port:SerialPort)=>void;reject:(error:Error)=>void};
const stageLabel=(stage:UpdateProgress["stage"])=>({
 checking:t("Checking update…","업데이트를 확인하는 중…"),"backing-up":t("Backing up settings…","설정을 백업하는 중…"),
 "entering-bootloader":t("Preparing keyboard…","키보드를 준비하는 중…"),"waiting-for-bootloader":t("Waiting for update connection…","업데이트 연결을 기다리는 중…"),
 transferring:t("Transferring firmware…","펌웨어를 전송하는 중…"),reconnecting:t("Reconnecting and checking the result…","다시 연결하고 결과를 확인하는 중…"),
 complete:t("Firmware update confirmed.","펌웨어 업데이트를 확인했습니다."),"needs-review":t("Update needs review. Your backup is kept.","업데이트 상태를 확인해야 합니다. 백업은 보관되어 있습니다."),
})[stage];
/** Web-first flow. Native inventory is an optional read-only diagnostic. */
export function NativeUpdatePanel(){
 const {conn}=useContext(ConnectionContext),lock=useContext(LockStateContext),connection=useContext(UpdateConnectionContext);
 const [identity,setIdentity]=useState<FirmwareIdentity|null>(null),[info,setInfo]=useState<BootloaderInfo[]>([]);
 const [backupId,setBackupId]=useState<string|null>(null);
 const [running,setRunning]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const [progress,setProgress]=useState<UpdateProgress|null>(null),[permission,setPermission]=useState<Permission|null>(null);
 const pending=useRef<Permission|null>(null);pending.current=permission;
 const native=!!window.__TAURI_INTERNALS__,web=!!navigator.serial&&window.isSecureContext;
 const policy=APPROVED_WEB_DFU_POLICIES.find(p=>p.model===identity?.model);
 const ready=!!conn&&!!policy&&identity?.bootloaderAllowed&&web&&lock===LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED;
 useEffect(()=>{let cancelled=false;if(running||!conn)return;
  void firmwareDevice(conn).then(d=>d.identity()).then(v=>{if(!cancelled)setIdentity(v);}).catch(()=>{if(!cancelled)setIdentity(null);});
  return()=>{cancelled=true;};
 },[conn,running]);
 useEffect(()=>()=>{pending.current?.reject(Error("Update panel closed."));},[]);
 useEffect(()=>{if(!running)return;const guard=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue="";};window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);},[running]);
 const start=async()=>{
  if(!ready||!conn||!policy||running)return;setRunning(true);connection.setUpdating(true);setError(null);
  try{
   setProgress({stage:"checking"});const response=await fetch(policy.packageUrl,{cache:"no-store"});
   if(!response.ok||Number(response.headers.get("Content-Length")??0)>3*1024*1024)throw Error("Update download failed or exceeds bounds.");
   const text=await response.text();if(text.length>3*1024*1024)throw Error("Update package exceeds bounds.");
   const ports=await browserUpdatePorts(conn,filters=>new Promise((resolve,reject)=>setPermission({filters,resolve,reject})),connection.adopt);
   await new FirmwareUpdateMachine(ports).run(text,p=>{setProgress(p);if(p.backupId)setBackupId(p.backupId);});
  }catch(e){setError(String(e));setProgress({stage:"needs-review",message:String(e)});}
  finally{setRunning(false);connection.setUpdating(false);}
 };
 return <section className="ry-card" aria-label={t("Firmware update","펌웨어 업데이트")}>
  <h2 className="ry-card-t">{t("Firmware update","펌웨어 업데이트")}</h2>
  <p>{ready?t("Back up, update and reconnect from this page.","이 페이지에서 백업·업데이트·재연결을 진행합니다."):t("Automatic updates are being validated for this development version.","이 개발 버전의 자동 업데이트를 검증하고 있습니다.")}</p>
  <p className="ry-note">{t("Supported PC browsers update over USB from the web. No app install or UF2 file copying is required. A browser device-permission prompt may appear.","지원되는 PC 브라우저에서는 웹에서 USB로 업데이트합니다. 앱 설치나 UF2 파일 복사는 필요하지 않습니다. 브라우저의 장치 선택 권한 창이 나타날 수 있습니다.")}</p>
  <button className="ry-primary" disabled={!ready||running} onClick={start}>{running?t("Updating…","업데이트 중…"):t("Update firmware","펌웨어 업데이트")}</button>
  {running&&<p role="status">{t("Keep the keyboard connected. Do not turn it off.","키보드 연결을 유지하세요. 기기를 끄지 마세요.")}</p>}
  {progress&&<p aria-live="polite">{stageLabel(progress.stage)}</p>}
  {progress?.stage==="transferring"&&progress.total!==undefined&&<progress max={progress.total} value={progress.written??0} aria-label={t("Firmware bytes transferred","펌웨어 전송량")} />}
  {permission&&<div className="ry-card"><p>{t("Choose the keyboard's update connection in the browser prompt.","브라우저 권한 창에서 키보드의 업데이트 연결을 선택하세요.")}</p>
   <button className="ry-primary" onClick={async()=>{const p=permission;try{p.resolve(await navigator.serial.requestPort({filters:p.filters}));}catch(e){p.reject(e instanceof Error?e:Error(String(e)));}finally{setPermission(null);}}}>{t("Choose update device","업데이트 장치 선택")}</button>
   <button className="ry-text" onClick={()=>{permission.reject(Error("Device permission cancelled."));setPermission(null);}}>{t("Cancel","취소")}</button>
  </div>}
  {backupId&&<button className="ry-text" onClick={async()=>{try{downloadText("ryong-update-backup.json",await readUpdateBackup(backupId));}catch(e){setError(String(e));}}}>{t("Download update backup","업데이트 백업 다운로드")}</button>}
  {backupId&&<p className="ry-note">{t("If recovery is needed, import this file into Dynamic settings first and save, then import it in Backup to restore key assignments. Each restore requires your explicit Save.","복구가 필요하면 이 파일을 동적 설정에서 먼저 불러와 저장한 뒤, 백업 탭에서 불러와 키 배치를 복원하세요. 복원은 각각 저장을 눌러야 적용됩니다.")}</p>}
  {error&&<p role="alert">{error}</p>}
  {native&&<details><summary>{t("Bootloader information (optional)","부트로더 정보 확인 (선택)")}</summary>
   <button className="ry-outline" disabled={busy||running} onClick={async()=>{setBusy(true);setError(null);try{setInfo(await invoke<BootloaderInfo[]>("firmware_bootloader_inventory"));}catch(e){setError(String(e));}finally{setBusy(false);}}}>{t("Read bootloader information","부트로더 정보 읽기")}</button>
   {info.map((v,i)=><details key={i}><summary>{v.board_id}</summary><pre style={{whiteSpace:"pre-wrap"}}>{v.info}</pre></details>)}
  </details>}
 </section>;
}
