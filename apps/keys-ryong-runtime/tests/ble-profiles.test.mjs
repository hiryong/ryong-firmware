import assert from "node:assert/strict";
import {buildSync} from "esbuild";
import vm from "node:vm";
import {createRequire} from "node:module";
const js=buildSync({stdin:{contents:'export * from "./src/ryong/runtime/bleProfiles"; export * as B from "./src/ryong/runtime/proto/ble_profiles";',resolveDir:process.cwd()},bundle:true,platform:"node",format:"cjs",write:false}).outputFiles[0].text;
const module={exports:{}};
vm.runInNewContext(js,{module,exports:module.exports,require:createRequire(import.meta.url),process,console,Uint8Array,TextEncoder,TextDecoder,Buffer,Set,WeakSet,setTimeout,clearTimeout,localStorage:{getItem:()=>"en",setItem(){}}});
const {BleProfileDevice,KeyboardError,normalizeName,B}=module.exports;

/* Fake firmware following profile_store.c semantics. */
let locked=false,lostAck=false,writes=0,active=0;
const slots=[{bonded:true,connected:true,name:"",owner:"mac"},{bonded:false,name:"",owner:""},{bonded:true,connected:false,name:"",owner:"pc"}];
const token=i=>slots[i].bonded?(i+1)*1000+slots[i].owner.length:0;
const state=()=>B.State.fromPartial({activeIndex:active,nameMaxBytes:30,protocolVersion:1,
  profiles:slots.map((s,index)=>({index,bonded:s.bonded,connected:!!(s.bonded&&s.connected),name:s.bonded?s.name:"",token:token(index)}))});
const reply=r=>B.Response.encode(B.Response.fromPartial(r)).finish();
const io={unlocked:async()=>{if(locked)throw Error("locked");},payload:async bytes=>{
  const q=B.Request.decode(bytes);
  if(q.getState)return reply({state:state()});
  writes++;
  if(q.select)active=q.select.index;
  else if(q.rename){const s=slots[q.rename.index];if(!s.bonded)return reply({status:{error:2}});if(q.rename.token!==token(q.rename.index))return reply({status:{error:116}});s.name=q.rename.name;}
  else if(q.clear){const s=slots[q.clear.index];if(q.clear.token!==token(q.clear.index))return reply({status:{error:116}});Object.assign(s,{bonded:false,connected:false,name:"",owner:""});}
  if(lostAck)throw Error("lost ACK");
  return reply({state:state()});
}};
const d=new BleProfileDevice({},21,io);
let s=await d.read();
assert.equal(s.profiles.length,3);assert.equal(s.profiles[0].connected,true);assert.equal(s.profiles[1].token,0);

/* Names: firmware-equivalent validation before any write. */
assert.equal(normalizeName("  회사   PC "),"회사 PC");
assert.throws(()=>normalizeName("가나다라마바사아자차카"),/NAME_TOO_LONG/);
assert.equal(normalizeName("a\nb"),"a b");assert.throws(()=>normalizeName("a\u0001b"),/NAME_INVALID/);
assert.throws(()=>normalizeName("x‮y"),/NAME_INVALID/);

locked=true;await assert.rejects(d.rename(0,"맥북",s),/locked|Unlock/);assert.equal(writes,0);locked=false;
s=await d.rename(0,"맥북",s);assert.equal(s.profiles[0].name,"맥북");assert.equal(writes,1);
await assert.rejects(d.rename(1,"x",s),KeyboardError);assert.equal(writes,1);

/* Slot re-paired after the UI read it: refused before sending anything. */
const stale=s;slots[2].owner="phone";
await assert.rejects(d.clear(2,stale),/changed/);assert.equal(writes,1);
s=await d.read();

/* Switch and keyboard-side clear with readback. */
s=await d.select(2,s);assert.equal(s.activeIndex,2);
s=await d.clear(2,s);assert.equal(s.profiles[2].bonded,false);assert.equal(s.profiles[2].name,"");assert.equal(s.activeIndex,2);
await assert.rejects(d.clear(2,s),KeyboardError);

/* Lost acknowledgement: one send, unknown result reported, no retry. */
lostAck=true;const before=writes;
await assert.rejects(d.select(0,s),/unknown/);assert.equal(writes,before+1);lostAck=false;
assert.equal((await d.read()).activeIndex,0);

/* Malformed replies are refused. */
const bad=new BleProfileDevice({},21,{unlocked:async()=>{},payload:async()=>reply({state:{protocolVersion:1,nameMaxBytes:30,activeIndex:5,profiles:[{index:0}]}})});
await assert.rejects(bad.read(),/Invalid/);
const leak=new BleProfileDevice({},21,{unlocked:async()=>{},payload:async()=>reply({state:{protocolVersion:1,nameMaxBytes:30,activeIndex:0,profiles:[{index:0,bonded:false,name:"old"}]}})});
await assert.rejects(leak.read(),/Invalid/);
console.log("PASS: Bluetooth manager names, stale-slot guard, switch, keyboard-side clear, lost ACK without retry, malformed replies");
