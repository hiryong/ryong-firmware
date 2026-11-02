/** Adafruit nRF52 legacy serial DFU/HCI framing, not Nordic Secure DFU.
 * Reference: Adafruit_nRF52_nrfutil 7fdfe15feee5f304fb7d9b031721dcefa1f72b58.
 * See NOTICE.md. No USB/serial access occurs in this module. */
export function crc16(bytes:Uint8Array){let crc=0xffff;for(const b of bytes){crc^=b<<8;for(let i=0;i<8;i++)crc=((crc<<1)^((crc&0x8000)?0x1021:0))&0xffff;}return crc;}
export function hciFrame(payload:Uint8Array,sequence:number){
 if(!Number.isInteger(sequence)||sequence<0||sequence>7||payload.length>516)throw Error("Invalid DFU frame bounds.");
 const frame=new Uint8Array(4+payload.length+2);
 frame[0]=sequence|(((sequence+1)%8)<<3)|0xc0;frame[1]=14|((payload.length&15)<<4);frame[2]=payload.length>>4;frame[3]=-(frame[0]+frame[1]+frame[2])&255;
 frame.set(payload,4);const crc=crc16(frame.subarray(0,-2));frame[frame.length-2]=crc&255;frame[frame.length-1]=crc>>8;
 const escaped=[0xc0];for(const b of frame){if(b===0xc0)escaped.push(0xdb,0xdc);else if(b===0xdb)escaped.push(0xdb,0xdd);else escaped.push(b);}escaped.push(0xc0);return new Uint8Array(escaped);
}
export class SlipDecoder {
 private frame:number[]=[];private escaped=false;private started=false;
 push(bytes:Uint8Array){const result:Uint8Array[]=[];
  for(const b of bytes){
   if(b===0xc0){if(this.escaped)throw Error("Truncated SLIP escape.");if(this.started&&this.frame.length)result.push(new Uint8Array(this.frame));this.frame=[];this.started=true;continue;}
   if(!this.started)continue;
   if(this.escaped){if(b!==0xdc&&b!==0xdd)throw Error("Invalid SLIP escape.");this.frame.push(b===0xdc?0xc0:0xdb);this.escaped=false;}
   else if(b===0xdb)this.escaped=true;else this.frame.push(b);
   if(this.frame.length>1024)throw Error("Oversized SLIP frame.");
  }return result;
 }
}
export function hciAcknowledgement(frame:Uint8Array){
 if(frame.length<4||((frame[0]+frame[1]+frame[2]+frame[3])&255)!==0)throw Error("Invalid HCI acknowledgement header.");
 const size=(frame[1]>>4)|(frame[2]<<4),withCrc=!!(frame[0]&0x40);
 if((frame[1]&15)!==0||size!==0||frame.length!==4+(withCrc?2:0))throw Error("Unexpected HCI acknowledgement payload.");
 if(withCrc&&crc16(frame.subarray(0,-2))!==(frame[frame.length-2]|frame[frame.length-1]<<8))throw Error("Invalid HCI acknowledgement CRC.");
 return (frame[0]>>3)&7;
}
export function words(...values:number[]){const data=new Uint8Array(values.length*4),view=new DataView(data.buffer);values.forEach((v,i)=>view.setUint32(i*4,v,true));return data;}
