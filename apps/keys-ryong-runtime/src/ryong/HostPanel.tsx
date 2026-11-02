import { useContext, useEffect, useState, useRef } from "react";
import { ConnectionContext } from "../rpc/ConnectionContext";
import { LockStateContext } from "../rpc/LockStateContext";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import { connectHostDevice, HostDevice, Os } from "./runtime/hostDevice";
import type { StateResponse } from "./runtime/proto/os_detection";
import { t } from "./i18n";
const apple=(os:Os)=>os===Os.OS_MACOS||os===Os.OS_IOS;
const layout=(os:Os)=>apple(os)?t("Apple · Command / Option","Apple · Command / Option"):t("Windows standard","Windows 표준");
export function HostPanel() {
  const {conn}=useContext(ConnectionContext), lock=useContext(LockStateContext);
  const [device,setDevice]=useState<HostDevice|null>(null),[state,setState]=useState<StateResponse|null>(null);
  const [error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
  const currentConn=useRef(conn); currentConn.current=conn;
  const [reload,setReload]=useState(0);
  const ready=!!conn&&lock===LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED;
  useEffect(()=>{
    let cancelled=false;setState(null);setDevice(null);setError(null);
    if(!ready||!conn)return;
    setBusy(true);
    (async()=>{const d=await connectHostDevice(conn);const s=await d.read();if(!cancelled){setDevice(d);setState(s);}})()
      .catch(e=>{if(!cancelled)setError(String(e));}).finally(()=>{if(!cancelled)setBusy(false);});
    return()=>{cancelled=true;};
  },[conn,ready,reload]);
  return <div className="ry-beh">
    <div><h1 className="ry-h1">{t("Host layout","호스트별 키 배치")}</h1>
      <p className="ry-lead">{t("Apple hosts use Command / Option; other or unknown hosts use Windows standard. Only OS-adaptive physical keys participate.","Apple 기기는 Command / Option, 나머지와 감지 불명은 Windows 표준을 사용합니다. OS 자동 전환으로 지정한 물리 키에만 적용합니다.")}</p></div>
    <p className="ry-note">{t("Automatic detection is a best-effort guess. A manual BLE profile choice takes precedence. Right Alt and macro outputs are preserved.","자동 감지는 추정이며 프로파일별 수동 지정이 우선합니다. 오른쪽 Alt와 매크로 출력은 그대로 유지합니다.")}</p>
    {!ready&&<p>{t("Connect and unlock a keyboard with host-layout firmware to inspect its profiles.","호스트 자동 전환 펌웨어가 있는 키보드를 연결하고 잠금을 풀면 프로파일을 확인할 수 있습니다.")}</p>}
    {error&&<p role="alert" className="ry-danger">{error}</p>}
    {busy&&<p role="status">{t("Reading keyboard…","키보드를 확인하는 중…")}</p>}
    {state&&<>
      <p>{t("Current layout","현재 배치")} · <strong>{layout(state.currentEffective)}</strong></p>
      <div className="ry-card"><h2>USB</h2><p>{state.usb?.connected?layout(state.usb.detected):t("Disconnected","연결 안 됨")}</p></div>
      {state.bleProfiles.map(profile=><div className="ry-card" key={profile.index}>
        <div className="ry-row"><strong>Bluetooth {profile.index+1}{state.activeProfileIndex===profile.index?" · "+t("Selected","선택됨"):""}</strong>
          <span className="ry-faint">{profile.connected?t("Connected","연결됨"):profile.bonded?t("Paired","등록됨"):t("Empty","비어 있음")}</span></div>
        <p>{t("Effective","적용 배치")} · {layout(profile.effective)}</p>
        <label>{t("Layout policy","배치 선택")} <select value={profile.override} disabled={busy||!ready||!profile.bonded}
          aria-label={t("Bluetooth {n} layout","Bluetooth {n} 배치",{n:profile.index+1})}
          onChange={async event=>{if(!device||!state)return;const next=Number(event.target.value) as Os;setBusy(true);setError(null);
            try{const s=await device.setOverride(profile.index,next,state);if(currentConn.current===device.conn)setState(s);}catch(e){if(currentConn.current===device.conn)setError(String(e));}finally{if(currentConn.current===device.conn)setBusy(false);}}}>
          <option value={Os.OS_UNKNOWN}>{t("Automatic","자동")}</option>
          <option value={Os.OS_WINDOWS}>{t("Windows standard","Windows 표준")}</option>
          <option value={Os.OS_MACOS}>Apple</option>
          {![Os.OS_UNKNOWN,Os.OS_WINDOWS,Os.OS_MACOS].includes(profile.override)&&<option value={profile.override}>{t("Existing custom choice","기존 지정")}</option>}
        </select></label>
      </div>)}
    </>}
    {ready&&<button className="ry-outline" disabled={busy} onClick={()=>setReload(n=>n+1)}>{t("Reload keyboard","장치에서 다시 읽기")}</button>}
  </div>;
}
