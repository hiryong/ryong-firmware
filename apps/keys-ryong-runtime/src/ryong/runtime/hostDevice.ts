import { call_rpc, RpcConnection } from "@zmkfirmware/zmk-studio-ts-client/index";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import { callRuntimePayload, discoverRuntime } from "./customRpc";
import * as O from "./proto/os_detection";
export { Os } from "./proto/os_detection";
async function unlocked(conn: RpcConnection) {
  const response = await call_rpc(conn, {core:{getLockState:true}});
  if (response.core?.getLockState !== LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED) throw new Error("Unlock Studio before changing host preferences.");
}
export class HostDevice {
  private busy = false;
  constructor(readonly conn: RpcConnection, readonly index: number, private readonly io = {
    unlocked: () => unlocked(conn),
    payload: (bytes: Uint8Array) => callRuntimePayload(conn, index, bytes),
  }) {}
  private async rpc(request: O.Request) {
    await this.io.unlocked();
    const response = O.Response.decode(await this.io.payload(O.Request.encode(request).finish()));
    if(response.error) throw new Error(response.error.message);
    return response;
  }
  async read() {
    const state=(await this.rpc(O.Request.fromPartial({getState:{}}))).state;
    if(!state || state.bleProfiles.length>8 || new Set(state.bleProfiles.map(p=>p.index)).size!==state.bleProfiles.length ||
       state.bleProfiles.some(p=>!Number.isInteger(p.index)||p.index<0||p.index>7)) throw new Error("Invalid host profile response.");
    return state;
  }
  async setOverride(index:number, os:O.Os, before:O.StateResponse) {
    if(this.busy) throw new Error("Another host preference save is in progress.");
    this.busy=true;
    try {
    if(![O.Os.OS_UNKNOWN,O.Os.OS_WINDOWS,O.Os.OS_MACOS].includes(os)) throw new Error("Unsupported host layout choice.");
    const current=await this.read();
    const expected=before.bleProfiles.find(p=>p.index===index), profile=current.bleProfiles.find(p=>p.index===index);
    if(!expected?.bonded||!profile?.bonded||profile.override!==expected.override) throw new Error("Host profile changed. Reload before saving.");
    const reply=await this.rpc(O.Request.fromPartial({setBleOverride:{profileIndex:index,os}}));
    if(reply.setBleOverride?.profile?.override!==os) throw new Error("Host setting was not acknowledged. Reload to inspect; do not retry automatically.");
    const state=await this.read();
    if(state.bleProfiles.find(p=>p.index===index)?.override!==os) throw new Error("Host setting readback differs. Reload to inspect.");
    return state;
    } finally { this.busy=false; }
  }
}
export async function connectHostDevice(conn:RpcConnection) {
  const entry=(await discoverRuntime(conn)).find(s=>s.identifier==="cormoran__os_detection");
  if(!entry) throw new Error("This firmware does not expose host OS detection.");
  return new HostDevice(conn,entry.index);
}
