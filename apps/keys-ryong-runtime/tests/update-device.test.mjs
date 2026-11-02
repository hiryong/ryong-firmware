import assert from "node:assert/strict";
import {buildSync} from "esbuild";
import vm from "node:vm";
import {createRequire} from "node:module";
const js=buildSync({stdin:{contents:'export * from "./src/ryong/runtime/updateDevice"; export * as U from "./src/ryong/runtime/proto/update";',resolveDir:process.cwd()},bundle:true,platform:"node",format:"cjs",write:false}).outputFiles[0].text;
const module={exports:{}};vm.runInNewContext(js,{module,exports:module.exports,require:createRequire(import.meta.url),process,console,Uint8Array,Buffer,TextEncoder,TextDecoder,setTimeout,clearTimeout});
const {firmwareDevice,U}=module.exports;let locked=false,lost=false,allowed=false,writes=0;const requests=[];
const io={discover:async()=>[{index:29,identifier:"ryong__firmware_identity"},{index:7,identifier:"ryong__firmware_update"}],random:()=>new Uint8Array(16).fill(7),core:async(_c,q)=>q.core.getDeviceInfo?{core:{getDeviceInfo:{serialNumber:new Uint8Array([0x12,0x34])}}}:{core:{getLockState:locked?0:1}},payload:async(_c,index,bytes)=>{
 const q=U.Request.decode(bytes);requests.push({index,q});if(q.identity){assert.equal(index,29);return U.Response.encode(U.Response.fromPartial({identity:{model:"test",buildId:"old",version:1,bootloaderAllowed:allowed}})).finish();}
 assert.equal(index,7);writes++;if(q.confirm&&lost)throw Error("lost confirmation");return U.Response.encode(U.Response.fromPartial({status:{ok:true}})).finish();
}};
const device=await firmwareDevice({},io);let identity=await device.identity();assert.equal(identity.unit,"1234");
await assert.rejects(device.enterBootloader(identity),/not approved/);assert.equal(writes,0);
allowed=true;identity=await device.identity();locked=true;await assert.rejects(device.enterBootloader(identity),/Unlock/);assert.equal(writes,0);
locked=false;await device.enterBootloader(identity);assert.equal(writes,2);assert.equal(requests.at(-2).q.prepare.expectedBuildId,"old");assert.equal(requests.at(-2).q.prepare.nonce.length,16);assert.equal(requests.at(-1).q.confirm.nonce.length,16);
lost=true;await assert.rejects(device.enterBootloader(identity),/lost confirmation/);assert.equal(writes,4);
await assert.rejects(firmwareDevice({}, {...io,discover:async()=>[]}),/does not expose/);
console.log("PASS: actual update protobuf, device-assigned subsystem IDs, public identity, disabled/locked zero writes, two-phase nonce and no retry after lost confirmation");
