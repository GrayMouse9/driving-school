import type {Chunk} from '../game/world/types';
import type {Player, Vehicle} from '../game/entities/types';
export function mapPoint(p:{x:number;z:number},center:{x:number;z:number},scale:number,size:number){return {x:size/2+(p.x-center.x)*scale,y:size/2+(p.z-center.z)*scale};}
export function drawMinimap(canvas:HTMLCanvasElement,chunks:Iterable<Chunk>,players:Player[],vehicles:Vehicle[],selfId:string){
 const c=canvas.getContext('2d');if(!c)return;const size=canvas.width;const self=players.find(p=>p.id===selfId);const center=self?.position??{x:32,z:32};const scale=size/110;
 const labels:{text:string;x:number;y:number}[]=[];
 const addLabel=(text:string,x:number,y:number,dx=0,dy=0)=>{if(x>=0&&x<=size&&y>=0&&y<=size)labels.push({text,x:x+dx,y:y+dy});};
 const directions={north:'север',east:'восток',south:'юг',west:'запад'};
 c.clearRect(0,0,size,size);c.fillStyle='#b3cda1';c.fillRect(0,0,size,size);c.save();c.beginPath();c.rect(0,0,size,size);c.clip();
 for(const chunk of chunks){const at=mapPoint(chunk.origin,center,scale,size);c.fillStyle='#a2bf8e';c.fillRect(at.x,at.y,chunk.size*scale,chunk.size*scale);
  for(const road of chunk.roads){const p=mapPoint(road.position,center,scale,size);c.save();c.translate(p.x,p.y);c.rotate(road.yaw);c.fillStyle='#748184';c.fillRect(-road.width*scale/2,-road.length*scale/2,road.width*scale,road.length*scale);c.restore();}
  for(const object of chunk.objects){if(object.kind==='tree')continue;const p=mapPoint(object.position,center,scale,size);c.save();c.translate(p.x,p.y);c.rotate(object.yaw);c.fillStyle=object.kind==='bus'?'#dfae43':object.color;c.fillRect(-object.size.x*scale/2,-object.size.z*scale/2,object.size.x*scale,object.size.z*scale);c.restore();
   if(object.kind==='bus')addLabel('Автобус',p.x,p.y,0,14);
  }
  for(const sign of chunk.agents){const p=mapPoint(sign.position,center,scale,size);c.fillStyle=sign.kind==='stop'?'#d75347':sign.kind==='priority'?'#f2cf52':'#3a8997';c.beginPath();c.arc(p.x,p.y,3.5,0,Math.PI*2);c.fill();
   const name={stop:'STOP',priority:'Главная',yield:'Уступите',crosswalk:'Переход'}[sign.kind];
   addLabel(sign.mainRoadArms?.length?`${name}: ${sign.mainRoadArms.map(arm=>directions[arm]).join(', ')}`:name,p.x,p.y,0,-9);
  }
  for(const marker of chunk.teaching?.markers??[]){const p=mapPoint(marker.position,center,scale,size);c.fillStyle='#e9b560';c.beginPath();c.arc(p.x,p.y,3,0,Math.PI*2);c.fill();addLabel(marker.label,p.x,p.y,10,4);}
 }
 for(const vehicle of vehicles){const p=mapPoint(vehicle.position,center,scale,size);c.save();c.translate(p.x,p.y);c.rotate(-vehicle.yaw);c.fillStyle=vehicle.driverId===selfId?'#fffaf0':vehicle.variant==='yellow'?'#e2b541':vehicle.variant==='green'?'#35a78a':'#529fc4';c.strokeStyle='#254c55';c.lineWidth=1.5;c.beginPath();c.moveTo(0,-6);c.lineTo(4,5);c.lineTo(0,3);c.lineTo(-4,5);c.closePath();c.fill();c.stroke();c.restore();
  const driver=players.find(player=>player.id===vehicle.driverId);
  if(driver)addLabel(driver.username,p.x,p.y,12,4);
  else if(vehicle.variant==='bus')addLabel('Автобус',p.x,p.y,0,14);
 }
 c.font='bold 10px system-ui';c.textAlign='center';c.lineWidth=3;c.strokeStyle='#faf7ed';c.fillStyle='#213d44';
 const occupied:{x:number;y:number;half:number}[]=[];
 for(const label of labels){
  let text=label.text;
  if(c.measureText(text).width>size-6){while(text.length&&c.measureText(text+'…').width>size-6)text=text.slice(0,-1);text+='…';}
  const half=c.measureText(text).width/2;
  const x=Math.max(half+3,Math.min(size-half-3,label.x));let y=Math.max(26,Math.min(size-6,label.y));
  for(let step=0;step<size/7;step++){
   const candidate=Math.max(26,Math.min(size-6,label.y+(step%2?-1:1)*Math.ceil(step/2)*14));
   if(occupied.every(other=>Math.abs(other.y-candidate)>=14||Math.abs(other.x-x)>=other.half+half+4)){y=candidate;break;}
  }
  occupied.push({x,y,half});
  c.lineWidth=1;c.beginPath();c.moveTo(label.x,label.y-4);c.lineTo(x,y-4);c.stroke();c.lineWidth=3;
  c.strokeText(text,x,y);c.fillText(text,x,y);
 }
 c.restore();c.fillStyle='#254c55';c.font='bold 10px system-ui';c.fillText('С',8,14);
 canvas.setAttribute('aria-label',`Ближайшие улицы. Север сверху. ${labels.map(label=>label.text).join('; ')}`);
}
