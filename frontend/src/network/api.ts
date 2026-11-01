import type {Envelope} from './protocol';
import type {Input} from '../game/player/types';
export const API='/api/v1';
const sizes=new WeakMap<object,number>();
export function receivedBytes(message:object){return sizes.get(message);}
let requestCounter=0;
// randomUUID is unavailable on ordinary HTTP LAN origins in some browsers.
export function requestId(){return globalThis.crypto?.randomUUID?.()??`req-${Date.now().toString(36)}-${++requestCounter}`;}
export async function http<T>(path:string,body?:unknown):Promise<T>{
 const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!response.ok){const data=await response.json().catch(()=>null);throw new Error(data?.error?.message??`HTTP ${response.status}`);}
 return response.status===204?undefined as T:response.json();
}
export class Network extends EventTarget {
 private ws?:WebSocket;private generation=0;private heartbeat?:ReturnType<typeof setInterval>;private lastMessage=0;private lastRevision=-1;private worldReady=false;private expectedLoadAck?:string;private worldVersion?:string;private fps?:number;
 ready=false;
 status(text:string){this.dispatchEvent(new CustomEvent('status',{detail:text}));}
 private raw(type:string,payload:unknown,id?:string){if(this.ws?.readyState!==WebSocket.OPEN)return false;this.ws.send(JSON.stringify({v:1,type,payload,...(id?{requestId:id}:{})}));return true;}
 async connect(){
  this.disconnect();const generation=this.generation;
  try{await http(`${API}/profile`);}catch(error){if(generation!==this.generation)return;throw error;}
  if(generation!==this.generation)return;
  this.status('Соединяемся…');
  const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`);this.ws=ws;
  ws.onopen=()=>{if(this.ws!==ws)return;this.lastMessage=Date.now();this.raw('join_world',{},requestId());
   this.heartbeat=setInterval(()=>{if(this.ws!==ws)return;if(Date.now()-this.lastMessage>30000){this.disconnect();this.status('Сервер не отвечает. Переподключитесь.');return;}this.raw('ping',{clientTime:Date.now()});},10000);
  };
  ws.onmessage=event=>{if(this.ws!==ws)return;try{
   const message=JSON.parse(event.data) as Envelope;
   if(message?.v!==1||typeof message.type!=='string'||message.payload===null||typeof message.payload!=='object')throw new Error('Неверный конверт сервера');
   sizes.set(message,new TextEncoder().encode(JSON.stringify(message.payload)).byteLength);this.lastMessage=Date.now();
   if(message.type==='world_joined'){this.ready=true;this.worldReady=false;this.lastRevision=-1;this.status('Подключено · загрузка города');}
   if(message.type==='pong'&&typeof message.payload.clientTime==='number'&&this.fps!==undefined){const ping=Date.now()-message.payload.clientTime;if(ping>=0&&ping<=30000)this.reportTelemetry(this.fps,ping);}
   if(message.type==='world_interest'){
    if(message.payload.worldVersion&&message.payload.worldVersion!==this.worldVersion){this.worldVersion=message.payload.worldVersion;this.lastRevision=-1;}const revision=message.payload.revision;if(!Number.isSafeInteger(revision)||revision<=this.lastRevision)return;
    this.lastRevision=revision;this.worldReady=false;this.expectedLoadAck=undefined;
   }
   if(message.type==='world_load_status'&&message.payload.revision===this.lastRevision&&message.requestId===this.expectedLoadAck&&!!this.expectedLoadAck){this.worldReady=message.payload.ready===true;this.status(this.worldReady?'Подключено':'Ошибка загрузки города');}
   if(message.type==='world_left'){this.ready=false;this.worldReady=false;this.dispatchEvent(new Event('disconnected'));}
   this.dispatchEvent(new CustomEvent('message',{detail:message}));
  }catch(error){this.status(`Ошибка протокола: ${String(error)}`);}};
  ws.onclose=()=>{if(this.ws!==ws)return;this.disconnect();this.status('Связь потеряна. Нажмите «Подключиться» для восстановления.');};
  ws.onerror=()=>{if(this.ws!==ws)return;this.disconnect();this.status('Ошибка соединения');};
 }
 send(type:string,payload:unknown,id?:string){if(!this.ready)return false;
  if(type==='vehicle_enter'||type==='vehicle_exit'||type==='vehicle.enter'||type==='vehicle.exit')return false;
  if(type==='player_input')return this.worldReady&&this.raw(type,payload);
  const outgoingId=id??(type==='ping'?undefined:requestId());if(type==='world_loaded')this.expectedLoadAck=outgoingId;return this.raw(type,payload,outgoingId);
 }
 input(payload:Input){const {seq,throttle,brake,steer}=payload;return this.send('player_input',{seq,throttle,brake,steer});}
 // service: сохраняет последнее измерение частоты кадров.
 setFPS(fps:number){this.fps=fps;}
 // service: отправляет показатели по действующему игровому соединению.
 reportTelemetry(fps:number,ping:number){return this.ready&&this.raw('telemetry',{fps,ping});}
 disconnect(){this.generation++;this.ready=false;this.worldReady=false;this.lastRevision=-1;this.expectedLoadAck=undefined;this.worldVersion=undefined;
  if(this.heartbeat){clearInterval(this.heartbeat);this.heartbeat=undefined;}const ws=this.ws;this.ws=undefined;ws?.close();this.dispatchEvent(new Event('disconnected'));
 }
}
