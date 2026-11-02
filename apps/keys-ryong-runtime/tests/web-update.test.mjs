import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import fs from "node:fs";
import {buildSync} from "esbuild";
import vm from "node:vm";
const js=buildSync({stdin:{contents:'export * from "./src/ryong/runtime/webUpdate/package";export * from "./src/ryong/runtime/webUpdate/serialDfuCodec";export * from "./src/ryong/runtime/webUpdate/serialDfu";',resolveDir:process.cwd()},bundle:true,platform:"node",format:"cjs",write:false}).outputFiles[0].text;
const module={exports:{}};vm.runInNewContext(js,{module,exports:module.exports,crypto:webcrypto,Uint8Array,ArrayBuffer,DataView,TextEncoder,structuredClone,atob,Number,Error,JSON,Object,setTimeout,clearTimeout});
const {VerifiedWebApplication,APPROVED_WEB_DFU_POLICIES,crc16,hciFrame,SlipDecoder,hciAcknowledgement,transferApplication,transferOverWebSerial}=module.exports;
assert.equal(APPROVED_WEB_DFU_POLICIES.length,0);assert.equal(crc16(new TextEncoder().encode("123456789")),0x29b1);
for(const v of JSON.parse(fs.readFileSync("tests/fixtures/adafruit-hci-vectors.json","utf8"))){assert.deepEqual(Array.from(hciFrame(new Uint8Array(v.payload),v.sequence)),v.frame);const d=new SlipDecoder();let result=[];for(const b of v.frame)result.push(...d.push(new Uint8Array([b])));assert.equal(result.length,1);}
const ack=n=>{const b=new Uint8Array(4);b[0]=n<<3;b[3]=-b[0]&255;return b;};
assert.equal(hciAcknowledgement(ack(2)),2);assert.throws(()=>hciAcknowledgement(new Uint8Array([0,0,0,1])),/header/);
assert.throws(()=>new SlipDecoder().push(new Uint8Array([0xc0,0xdb,1])),/escape/);
const keys=await webcrypto.subtle.generateKey("Ed25519",true,["sign","verify"]),publicKey=Array.from(new Uint8Array(await webcrypto.subtle.exportKey("raw",keys.publicKey)));
const policy={model:"test",boardId:"TEST_ONLY",keyId:"test-only",publicKey,family:0x12345678,applicationStart:0x1000,applicationEnd:0x2000,bootloaderVid:0xffff,bootloaderPid:0xffff,runtimeVid:0xfffe,runtimePid:0xfffe,packageUrl:"https://test.invalid/update.json"};
const uf2=new Uint8Array(512),u=new DataView(uf2.buffer);for(const [at,value]of[[0,0x0a324655],[4,0x9e5d5157],[8,0x2000],[12,0x1000],[16,256],[20,0],[24,1],[28,policy.family],[508,0x0ab16f30]])u.setUint32(at,value,true);
uf2.fill(0xa5,32,288);const init=new Uint8Array(16),hash=async b=>Buffer.from(await webcrypto.subtle.digest("SHA-256",b)).toString("hex");
const pack=async(image=uf2)=>{const manifest=JSON.stringify({format:"ryong-web-dfu-v1",model:"test",board_id:"TEST_ONLY",build_id:"new-test",version:2,image_sha256:await hash(image),init_sha256:await hash(init)});return JSON.stringify({manifest,image:Buffer.from(image).toString("base64"),init_packet:Buffer.from(init).toString("base64"),key_id:"test-only",signature:Buffer.from(await webcrypto.subtle.sign("Ed25519",keys.privateKey,new TextEncoder().encode("Ryong web DFU package v1\0"+manifest))).toString("base64")});};
const text=await pack();await assert.rejects(VerifiedWebApplication.verify(text,"test",1),/Unapproved/);await assert.rejects(VerifiedWebApplication.verify(text,"wrong",1,[policy]),/Unapproved/);await assert.rejects(VerifiedWebApplication.verify(text,"test",2,[policy]),/Unapproved/);
const application=await VerifiedWebApplication.verify(text,"test",1,[policy]);const data=application.data();data.binary[0]=0;assert.equal(application.data().binary[0],0xa5);
const tamper=JSON.parse(text);tamper.signature=Buffer.alloc(64).toString("base64");await assert.rejects(VerifiedWebApplication.verify(JSON.stringify(tamper),"test",1,[policy]),/signature/);
const invalid=uf2.slice();new DataView(invalid.buffer).setUint32(12,0,true);await assert.rejects(VerifiedWebApplication.verify(await pack(invalid),"test",1,[policy]),/application range/);
const wire=[],pauses=[],progress=[];let sequence;
const io={write:async bytes=>{wire.push(bytes);const f=new SlipDecoder().push(bytes)[0];sequence=f[0]&7;},ack:async()=>(sequence+1)%8,pause:async ms=>pauses.push(ms)};
const receipt=await transferApplication(application,io,(n,total)=>progress.push([n,total]));assert.equal(receipt.bytes,256);assert.equal(wire.length,4);assert.deepEqual(progress,[[0,256],[256,256]]);
const start=new SlipDecoder().push(wire[0])[0];assert.equal(new DataView(start.buffer).getUint32(8,true),4,"only APPLICATION mode is sent");
let writes=0;await assert.rejects(transferApplication(application,{...io,write:async()=>writes++,ack:async()=>7},()=>{}),/ACK differs/);assert.equal(writes,1);
let opened=false;await assert.rejects(transferOverWebSerial({getInfo:()=>({usbVendorId:1,usbProductId:1}),open:async()=>opened=true},application,()=>{}),/USB identity/);assert.equal(opened,false);
console.log("PASS: real browser crypto signature/hash/version/range checks, independently generated HCI vectors, fragmented SLIP, ACK validation, app-only transfer, no retries, USB policy gate before open");
if(process.env.RYONG_PLAYWRIGHT){
 const http=await import("node:http");const {chromium}=await import(process.env.RYONG_PLAYWRIGHT);
 const server=http.createServer((_req,res)=>{res.setHeader("Content-Type","text/html");res.end("<!doctype html><title>Local crypto test</title>");});await new Promise(r=>server.listen(0,"127.0.0.1",r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.RYONG_CHROMIUM});
 try{const page=await browser.newPage();await page.goto("http://127.0.0.1:"+server.address().port);
 const bundle=buildSync({entryPoints:["src/ryong/runtime/webUpdate/package.ts"],bundle:true,format:"iife",globalName:"RyongWebPackage",write:false}).outputFiles[0].text;
 await page.addScriptTag({content:bundle});
 const result=await page.evaluate(async({text,policy})=>{const v=await RyongWebPackage.VerifiedWebApplication.verify(text,"test",1,[policy]);return {build:v.buildId,size:v.data().binary.length,approved:RyongWebPackage.APPROVED_WEB_DFU_POLICIES.length};},{text,policy});
 assert.deepEqual(result,{build:"new-test",size:256,approved:0});console.log("PASS: actual Chromium WebCrypto Ed25519/SHA256 verification with no approved production policies and no device access");
 }finally{await browser.close();await new Promise(r=>server.close(r));}
}
