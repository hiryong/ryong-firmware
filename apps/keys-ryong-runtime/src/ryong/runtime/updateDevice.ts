import { RpcConnection } from "@zmkfirmware/zmk-studio-ts-client/index";
import { call_rpc } from "../../rpc/pipeline";
import {LockState} from "@zmkfirmware/zmk-studio-ts-client/core";
import {callRuntimePayload,discoverRuntime} from "./customRpc";
import * as U from "./proto/update";
async function bounded<T>(promise:Promise<T>):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("Update RPC timed out. Inspect device state; no retry was sent.")),6000);})]);}
 finally{clearTimeout(timer);}
}
export type FirmwareIdentity={model:string;buildId:string;version:number;unit:string;name?:string;bootloaderAllowed:boolean};
export async function firmwareDevice(conn:RpcConnection,io={
 discover:discoverRuntime,payload:callRuntimePayload,core:call_rpc,
 random:()=>crypto.getRandomValues(new Uint8Array(16)),
}){
 const subsystems=await io.discover(conn);
 const read=subsystems.find(s=>s.identifier==="ryong__firmware_identity"),write=subsystems.find(s=>s.identifier==="ryong__firmware_update");
 if(!read||!write)throw Error("Firmware does not expose a verified update bridge.");
 const rpc=async(index:number,request:U.Request)=>U.Response.decode(await bounded(io.payload(conn,index,U.Request.encode(request).finish())));
 return {
  async identity():Promise<FirmwareIdentity>{
   const identity=(await rpc(read.index,U.Request.fromPartial({identity:{}}))).identity;
   const core=(await bounded(io.core(conn,{core:{getDeviceInfo:true}}))).core?.getDeviceInfo;
   if(!identity?.model||identity.model.length>39||!identity.buildId||identity.buildId.length>64||!Number.isInteger(identity.version)||identity.version<0||identity.version>0x7fffffff||!core?.serialNumber.length||core.serialNumber.length>32)throw Error("Incomplete firmware/unit identity.");
   return {...identity,name:core.name||identity.model,unit:Array.from(core.serialNumber,b=>b.toString(16).padStart(2,"0")).join("")};
  },
  async enterBootloader(before:FirmwareIdentity){
   if(!before.bootloaderAllowed)throw Error("Automatic update is not approved for this firmware.");
   if((await bounded(io.core(conn,{core:{getLockState:true}}))).core?.getLockState!==LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED)throw Error("Unlock Studio before updating.");
   const nonce=io.random();
   if(nonce.length!==16)throw Error("Invalid update nonce.");
   const prepared=await rpc(write.index,U.Request.fromPartial({prepare:{nonce,expectedBuildId:before.buildId}}));
   if(!prepared.status?.ok)throw Error("Firmware rejected update preparation.");
   const confirmed=await rpc(write.index,U.Request.fromPartial({confirm:{nonce}}));
   if(!confirmed.status?.ok)throw Error("Firmware rejected bootloader entry. Inspect state; never retry automatically.");
  }
 };
}
