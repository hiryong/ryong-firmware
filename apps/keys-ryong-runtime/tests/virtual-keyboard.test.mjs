import assert from "node:assert/strict";
import {buildSync} from "esbuild";
import vm from "node:vm";
import {createRequire} from "node:module";
// Same pinned custom client the runtime build uses (experiments/runtime-client/prepare.sh).
const js=buildSync({stdin:{contents:'export * from "./src/ryong/virtual/virtualKeyboard"; export * as B from "./src/ryong/runtime/proto/ble_profiles"; export * as O from "./src/ryong/runtime/proto/os_detection";',resolveDir:process.cwd()},
  bundle:true,platform:"node",format:"cjs",write:false,alias:{"@zmkfirmware/zmk-studio-ts-client":"../../vendor/runtime-studio-client/lib"}}).outputFiles[0].text;
const store=new Map();
const module={exports:{}};
vm.runInNewContext(js,{module,exports:module.exports,require:createRequire(import.meta.url),console,Uint8Array,TextEncoder,TextDecoder,queueMicrotask,setTimeout,
  localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}});
const {getVirtualDevice,VIRTUAL_NAME,B,O}=module.exports;
const d=getVirtualDevice();
const sent=[];d.attach(m=>sent.push(m));
let id=0;const call=body=>d.handle({requestId:++id,...body}).requestResponse;
assert.equal(call({core:{getDeviceInfo:true}}).core.getDeviceInfo.name,VIRTUAL_NAME);
assert.equal(call({keymap:{getKeymap:true}}).meta.simpleError,1,"locked keyboard refuses keymap");
d.setLock(false);
const km=call({keymap:{getKeymap:true}}).keymap.getKeymap;
assert.equal(km.layers.length,3);for(const l of km.layers)assert.equal(l.bindings.length,61);
assert.equal(call({keymap:{getPhysicalLayouts:true}}).keymap.getPhysicalLayouts.layouts[0].keys.length,61);
assert.equal(call({keymap:{setLayerBinding:{layerId:0,keyPosition:15,binding:{behaviorId:1,param1:458793,param2:0}}}}).keymap.setLayerBinding,0);
assert.equal(call({keymap:{checkUnsavedChanges:true}}).keymap.checkUnsavedChanges,true);
d.reboot(); assert.equal(d.locked,true); d.setLock(false);
assert.notEqual(call({keymap:{getKeymap:true}}).keymap.getKeymap.layers[0].bindings[15].param1,458793,"unsaved edit lost on power cycle");
call({keymap:{setLayerBinding:{layerId:0,keyPosition:15,binding:{behaviorId:1,param1:458793,param2:0}}}});
assert.equal(call({keymap:{saveChanges:true}}).keymap.saveChanges.ok,true);
d.reboot(); d.setLock(false);
assert.equal(call({keymap:{getKeymap:true}}).keymap.getKeymap.layers[0].bindings[15].param1,458793,"saved edit survives");
// Bluetooth manager through the custom RPC, as the app calls it.
const subs=call({custom:{listCustomSubsystems:{}}}).custom.listCustomSubsystems.subsystems;
const ble=subs.find(s=>s.identifier==="ryong__ble_profiles").index;
const bcall=req=>B.Response.decode(call({custom:{call:{subsystemIndex:ble,payload:B.Request.encode(B.Request.fromPartial(req)).finish()}}}).custom.call.payload);
let st=bcall({getState:{}}).state;assert.equal(st.profiles[0].name,"맥북");assert.equal(st.profiles[2].bonded,false);
assert.equal(bcall({rename:{index:3,token:st.profiles[3].token+1,name:"x"}}).status.error,116);
st=bcall({rename:{index:3,token:st.profiles[3].token,name:"아이폰"}}).state;assert.equal(st.profiles[3].name,"아이폰");
const old=st.profiles[1].token;st=bcall({clear:{index:1,token:old}}).state;assert.equal(st.profiles[1].bonded,false);
assert.equal(bcall({clear:{index:1,token:old}}).status.error,2);
d.toggleLink(0);d.setLock(true);
assert.equal(call({custom:{call:{subsystemIndex:ble,payload:new Uint8Array()}}}).meta.simpleError,1,"secured while locked");
d.factoryReset();d.setLock(false);assert.equal(bcall({getState:{}}).state.profiles[1].name,"회사 PC");
assert.ok(sent.some(m=>m.notification?.core?.lockStateChanged===1),"unlock notification sent");
console.log("PASS: virtual keyboard keymap lock/save/power-cycle, Bluetooth manager tokens and locking, factory reset");
