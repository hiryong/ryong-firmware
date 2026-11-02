import {hciFrame,hciAcknowledgement,SlipDecoder,words} from "./serialDfuCodec";
import {VerifiedWebApplication} from "./package";
export interface DfuIo {write(bytes:Uint8Array):Promise<void>;ack():Promise<number>;pause(ms:number):Promise<void>;}
const concat=(...parts:Uint8Array[])=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;};
/** Application-only protocol. Never sends SoftDevice or bootloader update mode. */
export async function transferApplication(application:VerifiedWebApplication,io:DfuIo,progress:(sent:number,total:number)=>void){
 if(!(application instanceof VerifiedWebApplication))throw Error("A verified application package is required.");
 const {binary,init}=application.data();let sequence=0;
 const send=async(payload:Uint8Array)=>{sequence=(sequence+1)%8;await io.write(hciFrame(payload,sequence));if(await io.ack()!==(sequence+1)%8)throw Error("DFU ACK differs. Inspect state; never retry automatically.");};
 await send(words(3,4,0,0,binary.length));
 const pages=Math.floor(binary.length/4096)+1;await io.pause(Math.max(500,pages*89.7));
 await send(concat(words(1),init,new Uint8Array(2)));
 progress(0,binary.length);
 for(let offset=0,n=0;offset<binary.length;offset+=512,n++){
  const chunk=binary.subarray(offset,offset+512);await send(concat(words(4),chunk));progress(offset+chunk.length,binary.length);
  if(n%8===0)await io.pause(103);
 }
 await io.pause(103);await send(words(5));
 // Conservative dual-bank copy delay. Completion still requires reconnect identity.
 await io.pause(Math.max(500,pages*(89.7+102.4)));
 return {build_id:application.buildId,bytes:binary.length};
}
/** Port selection must originate in an explicit browser permission gesture.
 * This routine never requests ports, touches folders, or assumes a board policy. */
export async function transferOverWebSerial(port:SerialPort,application:VerifiedWebApplication,progress:(sent:number,total:number)=>void){
 if(!(application instanceof VerifiedWebApplication))throw Error("A verified application package is required.");
 const info=port.getInfo(),policy=application.policy;
 if(info.usbVendorId!==policy.bootloaderVid||info.usbProductId!==policy.bootloaderPid)throw Error("Selected bootloader USB identity differs.");
 await port.open({baudRate:115200,bufferSize:4096});
 if(!port.readable||!port.writable){await port.close();throw Error("Bootloader serial streams unavailable.");}
 const reader=port.readable.getReader(),writer=port.writable.getWriter(),decoder=new SlipDecoder();const frames:Uint8Array[]=[];
 const ack=async()=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([(async()=>{while(!frames.length){const result=await reader.read();if(result.done)throw Error("Bootloader disconnected before ACK.");frames.push(...decoder.push(result.value));}return hciAcknowledgement(frames.shift()!);})(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("DFU acknowledgement timed out; no retry was sent.")),5000);})]);}
  finally{clearTimeout(timer);}
 };
 try{
  await port.setSignals({dataTerminalReady:true});
  return await transferApplication(application,{write:async bytes=>writer.write(new Uint8Array(bytes)),ack,pause:ms=>new Promise(resolve=>setTimeout(resolve,ms))},progress);
 }finally{
  await reader.cancel().catch(()=>{});reader.releaseLock();writer.releaseLock();await port.close().catch(()=>{});
 }
}
