import type {Meta} from '../game/world/types';
import type {WorldInterest} from './protocol';
import type {Streamer} from '../game/world/streamer';
import {API} from './api';
async function readMeta(signal:AbortSignal,_version:string){
 const response=await fetch(`${API}/world/manifest`,{credentials:'same-origin',cache:'no-store',signal});if(!response.ok)throw new Error(`Метаданные мира: HTTP ${response.status}`);
 const reader=response.body?.getReader();if(!reader)throw new Error('Нет потока метаданных');let bytes=0,complete=false;const parts:Uint8Array[]=[];
 try{while(true){const r=await reader.read();if(r.done){complete=true;break;}bytes+=r.value.byteLength;if(bytes>16384)throw new Error('Слишком большой ответ метаданных');parts.push(r.value);}}
 finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
 const raw=new Uint8Array(bytes);let offset=0;for(const part of parts){raw.set(part,offset);offset+=part.byteLength;}return {meta:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)) as Meta,bytes};
}
// Owns lifetime across reconnects: a new budget cannot overlap an old cancelled read.
export class WorldConnection {
 private current?:Streamer;private retired=new Set<Streamer>();private generation=0;private version?:string;private revision=-1;
 private metadata?:Promise<{meta:Meta;bytes:number}>;private controller?:AbortController;private barrier:Promise<void>=Promise.resolve();
 constructor(private create:(meta:Meta,bytes:number)=>Streamer,private report:(text:string)=>void,private emit:(type:string,payload:unknown)=>unknown,private loadMeta=readMeta){}
 get accounting(){return this.current??this.retired.values().next().value;}
 get reservedBytes(){let sum=this.current?.reservedBytes??0;for(const old of this.retired)sum+=old.reservedBytes;return sum;}
 clear(){this.generation++;this.controller?.abort();this.controller=undefined;
  const metadata=this.metadata;this.metadata=undefined;const old=this.current;this.current=undefined;this.version=undefined;this.revision=-1;
  const waiting:Promise<unknown>[]=[this.barrier];if(metadata)waiting.push(metadata.catch(()=>{}));
  if(old){old.clear();this.retired.add(old);waiting.push(old.whenIdle().finally(()=>this.retired.delete(old)));}
  this.barrier=Promise.all(waiting).then(()=>{});
 }
 async interest(p:WorldInterest,measuredBytes?:number){
  if(this.version&&this.version!==p.worldVersion)this.clear();if(p.revision<=this.revision)return;
  this.version=p.worldVersion;this.revision=p.revision;const generation=this.generation;const live=()=>generation===this.generation&&p.revision===this.revision;
  await this.barrier;if(!live())return;
  try{
   this.controller??=new AbortController();const pending=this.metadata??=this.loadMeta(this.controller.signal,p.worldVersion);let data:{meta:Meta;bytes:number};
   try{data=await pending;}catch(error){if(this.metadata===pending)this.metadata=undefined;throw error;}
   if(!live())return;
   if(data.meta.version!==p.worldVersion){this.emit('world_load_failed',{revision:p.revision,code:'INVALID_DATA',chunkId:null,message:'Версия мира не совпадает'});this.report('Версия мира не совпадает');return;}
   this.current??=this.create(data.meta,data.bytes);await this.current.interest(p,measuredBytes);
  }catch(error){if(!live())return;const message=String(error);this.report(message);this.emit('world_load_failed',{revision:p.revision,code:message.includes('WORLD_BUDGET')?'BUDGET':'FETCH',chunkId:null,message:message.slice(0,500)});}
 }
}
