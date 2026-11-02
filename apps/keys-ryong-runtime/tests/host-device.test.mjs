import assert from "node:assert/strict";
import {buildSync} from "esbuild";
import vm from "node:vm";
import {createRequire} from "node:module";
const js=buildSync({stdin:{contents:'export * from "./src/ryong/runtime/hostDevice"; export * as O from "./src/ryong/runtime/proto/os_detection";',resolveDir:process.cwd()},bundle:true,platform:"node",format:"cjs",write:false}).outputFiles[0].text;
const module={exports:{}};vm.runInNewContext(js,{module,exports:module.exports,require:createRequire(import.meta.url),process,console,Uint8Array,TextEncoder,TextDecoder,Buffer,Set,WeakSet,setTimeout,clearTimeout});
const {HostDevice,O}=module.exports;
let locked=false,writes=0,ackLoss=false;
let profile=O.BleProfileState.fromPartial({index:0,bonded:true,override:O.Os.OS_UNKNOWN});
const io={unlocked:async()=>{if(locked)throw Error("locked");},payload:async bytes=>{
 const q=O.Request.decode(bytes);
 if(q.getState)return O.Response.encode(O.Response.fromPartial({state:{bleProfiles:[profile]}})).finish();
 if(q.setBleOverride){writes++;profile={...profile,override:q.setBleOverride.os};if(ackLoss)throw Error("lost ACK");return O.Response.encode(O.Response.fromPartial({setBleOverride:{profile}})).finish();}
 throw Error("unsupported");
}};
const d=new HostDevice({},19,io),before=await d.read();
locked=true;await assert.rejects(d.setOverride(0,O.Os.OS_MACOS,before),/locked/);assert.equal(writes,0);
locked=false;profile={...profile,override:O.Os.OS_WINDOWS};await assert.rejects(d.setOverride(0,O.Os.OS_MACOS,before),/changed/);assert.equal(writes,0);
profile={...profile,override:O.Os.OS_UNKNOWN};const saved=await d.setOverride(0,O.Os.OS_MACOS,before);assert.equal(saved.bleProfiles[0].override,O.Os.OS_MACOS);assert.equal(writes,1);
ackLoss=true;await assert.rejects(d.setOverride(0,O.Os.OS_WINDOWS,saved),/lost ACK/);assert.equal(writes,2);assert.equal((await d.read()).bleProfiles[0].override,O.Os.OS_WINDOWS);
profile={...profile,bonded:false};await assert.rejects(d.setOverride(0,O.Os.OS_UNKNOWN,await d.read()),/changed/);assert.equal(writes,2);
console.log("PASS: host preference actual protobuf roundtrip, lock, stale override, unbonded rejection and lost-ACK without retry");
