import assert from "node:assert/strict";
import {buildSync} from "esbuild";
import vm from "node:vm";
const js=buildSync({entryPoints:["src/ryong/runtime/updateMachine.ts"],bundle:true,platform:"node",format:"cjs",write:false}).outputFiles[0].text;
const module={exports:{}};vm.runInNewContext(js,{module,exports:module.exports,Number,Error,String});const {FirmwareUpdateMachine}=module.exports;
const original={model:"test",unit:"1234",buildId:"old",version:1,bootloaderAllowed:true};
const manifest={model:"test",board_id:"TEST",build_id:"new",version:2};
function fixture(fail){const calls=[],stages=[];const op=(name,value)=>async(...args)=>{calls.push(name);if(fail===name)throw Error(name);return typeof value==="function"?value(...args):structuredClone(value);};
 const ports={identity:op("identity",original),verify:op("verify",manifest),backup:op("backup",{}),persistBackup:op("persistBackup","backup-1"),assertTargetAbsent:op("assertTargetAbsent"),enterBootloader:op("enterBootloader"),waitForBootloader:op("waitForBootloader"),transfer:op("transfer",(_pkg,_before,progress)=>{progress(0,512);progress(512,512);return {build_id:"new",bytes:512};}),reconnect:op("reconnect",{...original,buildId:"new",version:2}),recordOutcome:op("recordOutcome")};
 return {ports,calls,stages,machine:new FirmwareUpdateMachine(ports)};}
const f=fixture();await f.machine.run("signed-package",p=>f.stages.push(p));assert.ok(f.calls.indexOf("persistBackup")<f.calls.indexOf("enterBootloader"));assert.equal(f.stages.at(-1).stage,"complete");
for(const fail of ["verify","backup","persistBackup","assertTargetAbsent"]){const f=fixture(fail);await assert.rejects(f.machine.run("signed",p=>f.stages.push(p)));assert.ok(!f.calls.includes("enterBootloader"));assert.ok(!f.calls.includes("transfer"));}
for(const fail of ["enterBootloader","waitForBootloader","transfer","reconnect"]){const f=fixture(fail);await assert.rejects(f.machine.run("signed",p=>f.stages.push(p)));assert.equal(f.calls.filter(x=>x===fail).length,1);assert.equal(f.stages.at(-1).stage,"needs-review");}
const wrong=fixture();wrong.ports.reconnect=async()=>({...original,unit:"another",buildId:"new",version:2});await assert.rejects(wrong.machine.run("signed",()=>{}),/does not match/);
const swapped=fixture();let reads=0;swapped.ports.identity=async()=>({...original,unit:++reads===1?"1234":"other"});await assert.rejects(swapped.machine.run("signed",()=>{}),/Device changed/);assert.ok(!swapped.calls.includes("enterBootloader"));
const concurrent=fixture();let release;const gate=new Promise(r=>release=r);concurrent.ports.backup=async()=>{await gate;return {};};const active=concurrent.machine.run("signed",()=>{});await assert.rejects(concurrent.machine.run("signed",()=>{}),/already running/);release();await active;
console.log("PASS: update ordering, backup-before-reboot, device swap, concurrency, failure stages, no retries, verified reconnect before completion");
