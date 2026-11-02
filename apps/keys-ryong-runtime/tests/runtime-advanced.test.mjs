import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import vm from "node:vm";
import { createRequire } from "node:module";
const js=buildSync({stdin:{contents:'export * from "./src/ryong/runtime/preview"; export * from "./src/ryong/runtime/modelBridge"; export * from "./src/ryong/runtime/profileFile";',resolveDir:process.cwd()},bundle:true,platform:"node",format:"cjs",write:false}).outputFiles[0].text;
const module={exports:{}},storage=new Map();
vm.runInNewContext(js,{module,exports:module.exports,require:createRequire(import.meta.url),Buffer,process,console,Uint8Array,TextEncoder,structuredClone,Set,WeakSet,btoa,setTimeout,clearTimeout,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}});
const {makePreviewView,viewDocument,compileDocument,exportProfile,importProfile}=module.exports;
let view=await makePreviewView();let doc=viewDocument(view);
assert.equal(doc.settings.length,2);
doc.tapDances.push({id:"new_dance",name:"Double",term:200,bindings:[{b:"kp",key:"A"},{b:"kp",key:"B"},{b:"kp",key:"C"}]});
doc.settings.find(s=>s.behavior==="mt").props["tapping-term-ms"]=275;
let prepared=0,completed=0;
const journal={prepare(){prepared++;},complete(){completed++;}};
view.snapshot=await view.session.save(view.snapshot,compileDocument(doc,view),journal);
doc=viewDocument(view);assert.equal(doc.tapDances[0].bindings.length,3);assert.equal(doc.settings.find(s=>s.behavior==="mt").props["tapping-term-ms"],275);
const id=doc.tapDances[0].id;
doc.tapDances[0].name="Renamed";doc.tapDances[0].bindings=doc.tapDances[0].bindings.slice(0,1);
view.snapshot=await view.session.save(view.snapshot,compileDocument(doc,view),journal);
assert.equal(viewDocument(view).tapDances[0].id,id);
assert.equal(viewDocument(view).tapDances[0].bindings.length,1);
const text=exportProfile(viewDocument(view),view);const restored=importProfile(text,view);
assert.equal(restored.tapDances[0].id,id);
const changedIds={...view,catalog:{...view.catalog,kp:201,ref:202,mt:217,lt:218,rtd:219}};
// Backup compatibility uses semantic behavior names, not firmware-local numbers.
assert.equal(JSON.parse(exportProfile(viewDocument(view),changedIds)).version,2);
const wrong=JSON.parse(text);wrong.compatibility.positions=62;
assert.throws(()=>importProfile(JSON.stringify(wrong),view),/compatibility/);
assert.throws(()=>importProfile("x".repeat(262145),view),/256/);
const invalid=structuredClone(restored);invalid.settings[0].props.flavor="invalid";
assert.throws(()=>compileDocument(invalid,view),/Hold-Tap/);
const nested=structuredClone(restored);nested.tapDances[0].bindings=[{b:"ref",id:"not-found"}];
assert.throws(()=>compileDocument(nested,view),/reference is missing/);
const mixed=structuredClone(restored);mixed.tapDances.push({...mixed.tapDances[0],id:"other",name:"Other",term:300});
assert.throws(()=>compileDocument(mixed,view),/global/);
doc=viewDocument(view);doc.tapDances=[];
view.snapshot=await view.session.save(view.snapshot,compileDocument(doc,view),journal);
assert.equal(viewDocument(view).tapDances.length,0);
doc=viewDocument(view);doc.tapDances.push({id:"newer",name:"New",term:200,bindings:[{b:"kp",key:"A"}]});
view.snapshot=await view.session.save(view.snapshot,compileDocument(doc,view),journal);
assert.notEqual(viewDocument(view).tapDances[0].id,id,"deleted stable IDs are never reused");
assert.equal(prepared,completed);
console.log("Advanced preview: create/rename/reduce/delete/stable IDs, Hold-Tap save, bounded compatible backup passed. Mock evidence only.");

// Cross-feature references are resolved using device-assigned IDs, never array order.
doc=viewDocument(view);
doc.macros.push({id:"cross-macro",name:"Cross",tap:30,wait:0,steps:[{t:"tap",binding:{b:"kp",key:"C"}}]});
doc.tapDances[0].bindings=[{b:"ref",id:"cross-macro"},{b:"kp",key:"B"}];
doc.combos[0].binding={b:"ref",id:doc.tapDances[0].id};
view.snapshot=await view.session.save(view.snapshot,compileDocument(doc,view),journal);
doc=viewDocument(view);
assert.equal(doc.tapDances[0].bindings[0].b,"ref");
assert.equal(doc.combos[0].binding.id,doc.tapDances[0].id);
doc.macros[0].name="Cross renamed";
view.snapshot=await view.session.save(view.snapshot,compileDocument(doc,view),journal);
assert.equal(viewDocument(view).macros[0].name,"Cross renamed");
console.log("Cross-feature: combo -> dance -> macro and macro rename passed (mock only)");

// Inject disconnection before and after every modeled cross-module mutation.
for (const after of [false,true]) for(let failurePoint=1;failurePoint<=25;failurePoint++) {
  const testModule={exports:{}},mem=new Map();
  vm.runInNewContext(js,{module:testModule,exports:testModule.exports,require:createRequire(import.meta.url),Buffer,process,console,Uint8Array,TextEncoder,structuredClone,Set,WeakSet,btoa,setTimeout,clearTimeout,localStorage:{getItem:k=>mem.get(k)??null,setItem:(k,v)=>mem.set(k,v)}});
  const api=testModule.exports;const v=await api.makePreviewView();let d=api.viewDocument(v);
  d.macros.push({id:"m",name:"Before",tap:30,wait:0,steps:[{t:"tap",binding:{b:"kp",key:"A"}}]});
  d.tapDances.push({id:"t",name:"Dance",term:200,bindings:[{b:"ref",id:"m"},{b:"kp",key:"B"}]});
  v.snapshot=await v.session.save(v.snapshot,api.compileDocument(d,v),{prepare(){},complete(){}});
  d=api.viewDocument(v);d.macros[0].name="After";
  const desired=api.compileDocument(d,v);let count=0,disconnected=false,pending=false;
  for(const [target,key] of [[v.session.port,"macro"],[v.session.port,"combo"],[v.session.port.advanced,"dance"],[v.session.port.advanced,"hold"]]) {
    const original=target[key];target[key]=async request=>{
      if(disconnected)throw new Error("disconnected");
      const mutation=!Object.keys(request).every(k=>/^(get|list|count)/.test(k));
      const hit=mutation && ++count===failurePoint;
      if(hit && !after){disconnected=true;throw new Error("disconnected before write");}
      const result=await original(request);
      if(hit && after){disconnected=true;throw new Error("lost ACK after write");}
      return result;
    };
  }
  try{await v.session.save(v.snapshot,desired,{prepare(){pending=true;},complete(){pending=false;}});}catch(error){assert.ok(disconnected,String(error));}
  if(disconnected)assert.equal(pending,true);
  const durable=JSON.parse(mem.get("ryong-runtime-preview-v1"));
  for(const dance of durable.advanced.dances) for(const binding of [dance.config?.singleBinding,dance.config?.doubleBinding,dance.config?.tripleBinding]) {
    if(binding?.behaviorId===2)assert.ok(durable.macros.some(m=>m.slot===binding.param1),"durable Tap Dance must not point at a deleted macro");
  }
}
console.log("50 cross-feature write/ACK-loss scenarios preserve durable macro references; mock flash only");
