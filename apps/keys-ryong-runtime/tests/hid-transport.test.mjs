// Studio over WebHID: report framing and a full request/response with a fake HID keyboard.
import assert from "node:assert/strict";
import {buildSync} from "esbuild";
import vm from "node:vm";
import {createRequire} from "node:module";
const js=buildSync({stdin:{contents:'export * from "./src/ryong/runtime/hidConnect";',resolveDir:process.cwd()},bundle:true,platform:"node",format:"cjs",write:false}).outputFiles[0].text;
const module={exports:{}};
class Ev extends Event{constructor(type,extra){super(type);Object.assign(this,extra);}}
const hid=new EventTarget();
const received=[];
const dev=Object.assign(new EventTarget(),{opened:false,productName:"Oreo",collections:[{usagePage:1,usage:6},{usagePage:0xff5a,usage:1}],
  async open(){this.opened=true;},async close(){this.opened=false;},
  async sendReport(id,data){assert.equal(id,0x10);assert.equal(data.length,32);received.push(...data.subarray(1,1+data[0]));
    // echo back reversed, split over 2 reports, like the firmware answering
    if(received.length===40){const back=[...received].reverse();for(let i=0;i<back.length;i+=31){const b=new Uint8Array(32);const part=back.slice(i,i+31);b[0]=part.length;b.set(part,1);
      setTimeout(()=>dev.dispatchEvent(new Ev("inputreport",{reportId:0x10,data:new DataView(b.buffer)})),0);}}}});
hid.getDevices=async()=>[dev];hid.requestDevice=async()=>{throw new Error("should use the allowed device");};
vm.runInNewContext(js,{module,exports:module.exports,require:createRequire(import.meta.url),navigator:{hid,language:"en"},performance,process,console,Uint8Array,DataView,DOMException,EventTarget,Event,ReadableStream,WritableStream,AbortController,setTimeout,localStorage:{getItem:()=>"en",setItem(){}}});
const {toReports,fromReport,openTransport,reportSizeOf,nameOf}=module.exports;
// report size from the descriptor (newer firmware 60, older/unknown 32)
assert.equal(reportSizeOf({collections:[{usagePage:0xff5a,usage:1,outputReports:[{reportId:0x10,items:[{reportSize:8,reportCount:60}]}]}]}),60);
assert.equal(reportSizeOf({collections:[{usagePage:0xff5a,usage:1}]}),32);
const big=toReports(new Uint8Array(100),60);assert.equal(big.length,2);assert.equal(big[0].length,60);assert.deepEqual([big[0][0],big[1][0]],[59,41]);

// framing
const r=toReports(new Uint8Array(70).map((_,i)=>i));
assert.equal(r.length,3);assert.deepEqual([...r.map(x=>x[0])],[31,31,8]);
assert.deepEqual([...fromReport(new DataView(r[2].buffer))],[62,63,64,65,66,67,68,69]);
const odd=new Uint8Array(32);odd[0]=200;assert.equal(fromReport(new DataView(odd.buffer)).length,31); // clamps bad lengths

// round trip through the transport
assert.equal(await nameOf(dev),"Oreo"); // a name from the browser is used as is
const tr=await openTransport(dev);
assert.equal(tr.label,"Oreo");assert.equal(dev.opened,true);
const w=tr.writable.getWriter();await w.write(new Uint8Array(40).map((_,i)=>i));
const rd=tr.readable.getReader();let got=[];while(got.length<40){const {value}=await rd.read();got.push(...value);}
assert.deepEqual(got,[...Array(40).keys()].reverse());
tr.abortController.abort();await new Promise(r=>setTimeout(r,0));assert.equal(dev.opened,false);
console.log("PASS: Studio WebHID transport framing, name, round trip, close");
