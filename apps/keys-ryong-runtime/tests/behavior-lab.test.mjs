import assert from "node:assert/strict";
import {buildSync} from "esbuild";
import vm from "node:vm";
const js=buildSync({entryPoints:["src/ryong/behaviors/labEngine.ts"],bundle:true,platform:"node",format:"cjs",write:false}).outputFiles[0].text;
const module={exports:{}};vm.runInNewContext(js,{module,exports:module.exports});
const {holdTap,tapDance,combo,macroTimeline}=module.exports;
const ev=(...xs)=>xs.map(([k,down,t])=>({k,down,t}));
const L=r=>r.outputs.map(o=>`${o.label}@${o.t}`).join(" ");
const mt={term:200,flavor:"hold-preferred",quickTap:0,tapLabel:"F",holdLabel:"Shift",otherLabel:"J"};
// ZMK docs: tap before term = F; hold past term = Shift.
assert.equal(L(holdTap(ev(["a",1,0],["a",0,120]),mt)),"F@120");
assert.equal(L(holdTap(ev(["a",1,0],["a",0,400]),mt)),"Shift@200");
// Interrupt: hold-preferred decides hold at the other key's press; J waits for the decision.
assert.equal(L(holdTap(ev(["a",1,0],["o",1,80],["o",0,120],["a",0,150]),mt)),"Shift@80 J@80");
// balanced: hold only when the other key is released while still held.
assert.equal(L(holdTap(ev(["a",1,0],["o",1,80],["a",0,100],["o",0,140]),{...mt,flavor:"balanced"})),"F@100 J@100");
assert.equal(L(holdTap(ev(["a",1,0],["o",1,80],["o",0,120],["a",0,150]),{...mt,flavor:"balanced"})),"Shift@120 J@120");
// tap-preferred ignores interrupts; tap-unless-interrupted taps on timeout.
assert.equal(L(holdTap(ev(["a",1,0],["o",1,80],["a",0,150],["o",0,160]),{...mt,flavor:"tap-preferred"})),"F@150 J@150");
assert.equal(L(holdTap(ev(["a",1,0],["a",0,400]),{...mt,flavor:"tap-unless-interrupted"})),"F@200");
// quick-tap: tap then press again quickly = repeat tap even if held.
assert.equal(L(holdTap(ev(["a",1,0],["a",0,50],["a",1,120],["a",0,600]),{...mt,quickTap:150})),"F@50 F@120");
// Live: still deciding before the term.
assert.equal(holdTap(ev(["a",1,0]),mt,150).outputs.length,0);
assert.equal(L(holdTap(ev(["a",1,0]),mt,250)),"Shift@200");
// Tap dance (ZMK diagrams): 1 tap after term, 2 taps after term, 3 = max decides at once, interrupt decides now.
const td={term:100,labels:["1","2","3"],otherLabel:"j"};
assert.equal(L(tapDance(ev(["a",1,0],["a",0,30]),td)),"1@100");
assert.equal(L(tapDance(ev(["a",1,0],["a",0,30],["a",1,60],["a",0,90]),td)),"2@160");
assert.equal(L(tapDance(ev(["a",1,0],["a",0,20],["a",1,40],["a",0,60],["a",1,80],["a",0,100]),td)),"3@80");
assert.equal(L(tapDance(ev(["a",1,0],["a",0,20],["o",1,50],["o",0,80]),td)),"1@50 j@50");
const held=tapDance(ev(["a",1,0],["a",0,300]),td);assert.equal(held.outputs[0].kind,"hold");
// Combo: both within timeout = combo; too slow = separate keys.
const cb={timeout:50,keys:["a","b"],labels:{a:"J",b:"K"},comboLabel:"Esc"};
assert.equal(L(combo(ev(["a",1,0],["b",1,30],["a",0,90],["b",0,95]),cb)),"Esc@30");
assert.equal(L(combo(ev(["a",1,0],["b",1,80],["a",0,120],["b",0,130]),cb)),"J@50 K@130"); // K starts its own combo wait; sent on release or timeout
assert.equal(L(combo(ev(["a",1,0],["a",0,20]),cb)),"J@20");
// Macro timeline: text taps spaced by tap+wait.
const m=macroTimeline([{kind:"text",label:"Hi"},{kind:"wait",label:"",ms:100},{kind:"tap",label:"Enter"}],10,30);
assert.equal(L(m),"H@0 i@40 Enter@180");
console.log("PASS: behavior lab engine matches ZMK hold-tap flavors, quick-tap, tap dance, combos and macro timing");
