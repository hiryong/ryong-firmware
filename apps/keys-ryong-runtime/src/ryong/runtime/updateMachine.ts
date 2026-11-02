import type {FirmwareIdentity} from "./updateDevice";
export type VerifiedManifest={model:string;board_id:string;build_id:string;version:number};
export type UpdateStage="checking"|"backing-up"|"entering-bootloader"|"waiting-for-bootloader"|"transferring"|"reconnecting"|"complete"|"needs-review";
export type UpdateProgress={stage:UpdateStage;written?:number;total?:number;message?:string;backupId?:string};
export interface UpdatePorts {
 identity():Promise<FirmwareIdentity>;
 verify(packageJson:string,before:FirmwareIdentity):Promise<VerifiedManifest>;
 backup(before:FirmwareIdentity):Promise<unknown>;
 persistBackup(backup:unknown):Promise<string>;
 assertTargetAbsent(manifest:VerifiedManifest):Promise<void>;
 enterBootloader(before:FirmwareIdentity):Promise<void>;
 waitForBootloader(manifest:VerifiedManifest):Promise<void>;
 transfer(packageJson:string,before:FirmwareIdentity,progress:(written:number,total:number)=>void):Promise<{build_id:string;bytes:number}>;
 reconnect(before:FirmwareIdentity):Promise<FirmwareIdentity>;
 recordOutcome(backupId:string,result:{ok:boolean;before:FirmwareIdentity;expected:VerifiedManifest;message?:string}):Promise<void>;
}
/** Mutation starts only AFTER verified durable backup. No synthetic progress,
 * automatic retries, settings reset or success based only on copying bytes. */
export class FirmwareUpdateMachine {
 private busy=false;
 constructor(private ports:UpdatePorts){}
 async run(packageJson:string,report:(progress:UpdateProgress)=>void){
  if(this.busy)throw Error("An update is already running.");
  this.busy=true;let backupId:string|undefined,before:FirmwareIdentity|undefined,expected:VerifiedManifest|undefined;
  try{
   report({stage:"checking"});before=await this.ports.identity();
   if(!before.bootloaderAllowed)throw Error("Automatic update is not approved for this firmware.");
   expected=await this.ports.verify(packageJson,before);
   if(expected.model!==before.model||!expected.board_id||!expected.build_id||!Number.isSafeInteger(expected.version)||expected.version<=before.version)throw Error("Incompatible update manifest.");
   await this.ports.assertTargetAbsent(expected);
   report({stage:"backing-up"});backupId=await this.ports.persistBackup(await this.ports.backup(before));
   if(!backupId)throw Error("No durable backup acknowledgement.");
   const current=await this.ports.identity();
   if(current.unit!==before.unit||current.model!==before.model||current.buildId!==before.buildId||current.version!==before.version)throw Error("Device changed after backup.");
   report({stage:"entering-bootloader",backupId});await this.ports.enterBootloader(before);
   report({stage:"waiting-for-bootloader"});await this.ports.waitForBootloader(expected);
   report({stage:"transferring"});const receipt=await this.ports.transfer(packageJson,before,(written,total)=>{
    if(Number.isSafeInteger(written)&&Number.isSafeInteger(total)&&total>0&&written>=0&&written<=total)report({stage:"transferring",written,total});
   });
   if(receipt.build_id!==expected.build_id||receipt.bytes<=0)throw Error("Unexpected transfer receipt.");
   report({stage:"reconnecting"});const after=await this.ports.reconnect(before);
   if(after.unit!==before.unit||after.model!==before.model||after.buildId!==expected.build_id||after.version!==expected.version)throw Error("Reconnected device/build does not match. Keep the backup and inspect recovery.");
   await this.ports.recordOutcome(backupId,{ok:true,before,expected});report({stage:"complete"});return after;
  }catch(error){
   const message=String(error);report({stage:"needs-review",message});
   if(backupId&&before&&expected){try{await this.ports.recordOutcome(backupId,{ok:false,before,expected,message});}catch{}}
   throw error;
  }finally{this.busy=false;}
 }
}
