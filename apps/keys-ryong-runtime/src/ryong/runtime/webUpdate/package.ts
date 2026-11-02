export type WebDfuPolicy={model:string;boardId:string;keyId:string;publicKey:number[];family:number;applicationStart:number;applicationEnd:number;bootloaderVid:number;bootloaderPid:number;runtimeVid:number;runtimePid:number;packageUrl:string};
/** Empty until actual board/bootloader identity, app offset and recovery pass QA. */
export const APPROVED_WEB_DFU_POLICIES:readonly WebDfuPolicy[]=[];
const bytes=(s:string)=>{if(typeof s!=="string")throw Error("Invalid package encoding.");return Uint8Array.from(atob(s),c=>c.charCodeAt(0));};
const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,"0")).join("");
const digest=async(b:Uint8Array)=>hex(await crypto.subtle.digest("SHA-256",new Uint8Array(b).buffer));
export class VerifiedWebApplication {
 #binary:Uint8Array;#init:Uint8Array;
 private constructor(readonly model:string,readonly boardId:string,readonly buildId:string,readonly version:number,readonly policy:Readonly<WebDfuPolicy>,binary:Uint8Array,init:Uint8Array){this.#binary=binary;this.#init=init;}
 data(){return {binary:this.#binary.slice(),init:this.#init.slice()};}
 static async verify(text:string,model:string,version:number,policies:readonly WebDfuPolicy[]=APPROVED_WEB_DFU_POLICIES){
  if(text.length>3*1024*1024)throw Error("Update package exceeds bounds.");
  const pkg=JSON.parse(text);if(typeof pkg.manifest!=="string"||pkg.manifest.length>8192)throw Error("Invalid signed manifest.");
  const m=JSON.parse(pkg.manifest),p=policies.find(p=>p.model===m.model&&p.boardId===m.board_id&&p.keyId===pkg.key_id);
  if(!p||m.format!=="ryong-web-dfu-v1"||m.model!==model||!Number.isSafeInteger(m.version)||m.version<=version||m.version>0x7fffffff||typeof m.build_id!=="string"||!m.build_id||m.build_id.length>64||!/^[\x20-\x7e]+$/.test(m.build_id))throw Error("Unapproved board, package or version.");
  const policy=Object.freeze(structuredClone(p));
  if(policy.publicKey.length!==32||!Number.isInteger(policy.applicationStart)||!Number.isInteger(policy.applicationEnd)||policy.applicationStart<0||policy.applicationEnd<=policy.applicationStart||policy.applicationEnd>0x100000||!policy.bootloaderVid||!policy.bootloaderPid||!policy.runtimeVid||!policy.runtimePid||typeof policy.packageUrl!=="string"||!policy.packageUrl.startsWith("https://"))throw Error("Invalid release policy.");
  const key=await crypto.subtle.importKey("raw",new Uint8Array(policy.publicKey).buffer,{name:"Ed25519"},false,["verify"]);
  const message=new TextEncoder().encode("Ryong web DFU package v1\0"+pkg.manifest);
  if(!await crypto.subtle.verify("Ed25519",key,new Uint8Array(bytes(pkg.signature)).buffer,new Uint8Array(message).buffer))throw Error("Invalid update signature.");
  const uf2=bytes(pkg.image),init=bytes(pkg.init_packet);
  if(uf2.length<512||uf2.length>2*1024*1024||uf2.length%512||init.length<12||init.length>500||await digest(uf2)!==m.image_sha256||await digest(init)!==m.init_sha256)throw Error("Update data hash or bounds differ.");
  const binary=new Uint8Array(uf2.length/2),count=uf2.length/512;
  for(let i=0;i<count;i++){
   const block=uf2.subarray(i*512,(i+1)*512),v=new DataView(block.buffer,block.byteOffset,512),u=(o:number)=>v.getUint32(o,true);
   if(u(0)!==0x0a324655||u(4)!==0x9e5d5157||u(508)!==0x0ab16f30||u(8)!==0x2000||u(28)!==policy.family||u(16)!==256||u(20)!==i||u(24)!==count||u(12)!==policy.applicationStart+i*256||u(12)+256>policy.applicationEnd)throw Error("UF2 is not the approved contiguous application range.");
   binary.set(block.subarray(32,288),i*256);
  }
  return new VerifiedWebApplication(m.model,m.board_id,m.build_id,m.version,policy,binary,init);
 }
}
