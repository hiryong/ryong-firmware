import {create_rpc_connection,RpcConnection} from "@zmkfirmware/zmk-studio-ts-client/index";
import { call_rpc } from "../../../rpc/pipeline";
import {connectHostDevice} from "../hostDevice";
import {createBackup} from "../../backup";
import {exportProfile} from "../profileFile";
import {loadRuntimeView,viewDocument} from "../modelBridge";
import {firmwareDevice} from "../updateDevice";
import type {UpdatePorts} from "../updateMachine";
import {APPROVED_WEB_DFU_POLICIES,VerifiedWebApplication} from "./package";
import {transferOverWebSerial} from "./serialDfu";
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function database(){return new Promise<IDBDatabase>((resolve,reject)=>{const open=indexedDB.open("ryong-firmware-updates",1);open.onupgradeneeded=()=>open.result.createObjectStore("backups");open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);});}
export async function storeUpdateBackup(record:unknown){
 const db=await database(),id=crypto.randomUUID();
 try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction("backups","readwrite",{durability:"strict"});tx.objectStore("backups").add({backup:record,createdAt:Date.now()},id);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error??Error("Backup transaction aborted."));tx.onerror=()=>reject(tx.error);});return id;}finally{db.close();}
}
export async function readUpdateBackup(id:string){
 const db=await database();try{return await new Promise<string>((resolve,reject)=>{
  const tx=db.transaction("backups","readonly"),request=tx.objectStore("backups").get(id);
  request.onsuccess=()=>request.result?.backup?resolve(JSON.stringify(request.result.backup,null,2)):reject(Error("Update backup is missing."));request.onerror=()=>reject(request.error);
 });}finally{db.close();}
}
async function recordOutcome(id:string,result:unknown){
 const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction("backups","readwrite",{durability:"strict"}),store=tx.objectStore("backups"),read=store.get(id);read.onsuccess=()=>{if(!read.result){tx.abort();return;}store.put({...read.result,result},id);};tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error??Error("Update record missing."));tx.onerror=()=>reject(tx.error);});}finally{db.close();}
}
/** Browser adapters never install a local helper or request filesystem folders. */
export async function browserUpdatePorts(conn:RpcConnection,chooseBootloader:(filters:SerialPortFilter[])=>Promise<SerialPort>,adopt:(conn:RpcConnection,name:string,abort:AbortController)=>void):Promise<UpdatePorts>{
 if(!navigator.serial||!window.isSecureContext)throw Error("A secure browser with Web Serial is required.");
 const device=await firmwareDevice(conn);let approved:VerifiedWebApplication|undefined,verifiedText:string|undefined,port:SerialPort|undefined;
 const matching=async()=>{if(!approved)throw Error("Package not verified.");const p=approved.policy;return (await navigator.serial.getPorts()).filter(port=>{const i=port.getInfo();return i.usbVendorId===p.bootloaderVid&&i.usbProductId===p.bootloaderPid;});};
 return {
  identity:()=>device.identity(),
  async verify(text,before){approved=await VerifiedWebApplication.verify(text,before.model,before.version,APPROVED_WEB_DFU_POLICIES);verifiedText=text;return {model:approved.model,board_id:approved.boardId,build_id:approved.buildId,version:approved.version};},
  async assertTargetAbsent(){if((await matching()).length)throw Error("Another matching bootloader is already connected. Leave only the keyboard being updated.");},
  async backup(before){
   if(localStorage.getItem("ryong-runtime-editor-draft:"+conn.label)||localStorage.getItem("ryong-runtime-pending:"+conn.label))throw Error("Review/save pending dynamic edits before updating.");
   const dirty=(await call_rpc(conn,{keymap:{checkUnsavedChanges:true}})).keymap?.checkUnsavedChanges;
   if(dirty!==false)throw Error("Save or discard keymap edits before updating.");
   const keymap=await createBackup(conn,before.model),view=await loadRuntimeView(conn);
   if(keymap.layers.some(l=>l.bindings.some(b=>b.behavior.startsWith("#"))))throw Error("Incomplete keymap behavior backup.");
   const semanticKeymap={...keymap,layers:keymap.layers.map((layer,li)=>({...layer,bindings:layer.bindings.map((binding,pos)=>{
    const raw=view.snapshot.keymap?.layers[li]?.bindings[pos];
    const macro=raw?.behaviorId===view.catalog.ref?view.snapshot.macros.find(m=>m.slot===raw.param1):undefined;
    const dance=raw?.behaviorId===view.catalog.rtd?view.snapshot.advanced?.dances.find(d=>d.index===raw.param1):undefined;
    return {...binding,...(macro?{dynamicReference:{kind:"macro",name:macro.name}}:dance?{dynamicReference:{kind:"dance",name:dance.name}}:{})};
   })}))};
   const host=await (await connectHostDevice(conn)).read();
   return {format:"ryong-update-backup",version:1,identity:before,keymap:semanticKeymap,dynamic:JSON.parse(exportProfile(viewDocument(view),view)),host};
  },
  persistBackup:storeUpdateBackup,
  enterBootloader:before=>device.enterBootloader(before),
  async waitForBootloader(){
   if(!approved)throw Error("Package not verified.");
   // Device permissions are browser-owned. Previously granted ports reconnect
   // automatically; first-use selection is an explicit UI gesture callback.
   await pause(1200);const granted=await matching();
   if(granted.length>1)throw Error("Ambiguous bootloader ports.");
   port=granted[0]??await chooseBootloader([{usbVendorId:approved.policy.bootloaderVid,usbProductId:approved.policy.bootloaderPid}]);
  },
  async transfer(text,_before,progress){if(!approved||text!==verifiedText||!port)throw Error("Verified update session changed.");return transferOverWebSerial(port,approved,progress);},
  async reconnect(before){
   if(!approved)throw Error("Package not verified.");const policy=approved.policy,deadline=Date.now()+30000;
   while(Date.now()<deadline){
    const candidates=(await navigator.serial.getPorts()).filter(p=>{const i=p.getInfo();return i.usbVendorId===policy.runtimeVid&&i.usbProductId===policy.runtimePid;});
    if(candidates.length>1)throw Error("More than one matching application port. Reconnect the keyboard manually to inspect.");
    const p=candidates[0];if(!p){await pause(500);continue;}
    try{await p.open({baudRate:12500});}catch{await pause(500);continue;}
    const abort=new AbortController();
    try{
     if(!p.readable||!p.writable)throw Error("Application streams missing.");
     abort.signal.addEventListener("abort",()=>{void p.close().catch(()=>{});},{once:true});
     const next=await create_rpc_connection({label:before.model,abortController:abort,readable:p.readable,writable:p.writable},{signal:abort.signal});
     const identity=await (await firmwareDevice(next)).identity();
     if(identity.unit!==before.unit||identity.model!==before.model)throw Error("Reconnected keyboard identity differs.");
     adopt(next,identity.name??before.model,abort);return identity;
    }catch(error){abort.abort();await p.close().catch(()=>{});throw error;}
   }
   throw Error("Keyboard reconnection timed out. Keep the backup and inspect recovery; no retry was sent.");
  },
  recordOutcome,
 };
}
