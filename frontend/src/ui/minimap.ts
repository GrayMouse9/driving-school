import type {Chunk} from '../game/world/types';
import type {Player, Vehicle} from '../game/entities/types';
export function mapPoint(p:{x:number;z:number},center:{x:number;z:number},scale:number,size:number){return {x:size/2+(p.x-center.x)*scale,y:size/2+(p.z-center.z)*scale};}
export function drawMinimap(canvas:HTMLCanvasElement,chunks:Iterable<Chunk>,players:Player[],vehicles:Vehicle[],selfId:string){
 const c=canvas.getContext('2d');if(!c)return;const size=canvas.width;const self=players.find(p=>p.id===selfId);const center=self?.position??{x:32,z:32};const scale=size/110;
 c.clearRect(0,0,size,size);c.fillStyle='#b3cda1';c.fillRect(0,0,size,size);c.save();c.beginPath();c.rect(0,0,size,size);c.clip();
 for(const chunk of chunks){const at=mapPoint(chunk.origin,center,scale,size);c.fillStyle='#a2bf8e';c.fillRect(at.x,at.y,chunk.size*scale,chunk.size*scale);
  for(const road of chunk.roads){const p=mapPoint(road.position,center,scale,size);c.save();c.translate(p.x,p.y);c.rotate(road.yaw);c.fillStyle='#748184';c.fillRect(-road.width*scale/2,-road.length*scale/2,road.width*scale,road.length*scale);c.restore();}
  for(const object of chunk.objects){if(object.kind==='tree')continue;const p=mapPoint(object.position,center,scale,size);c.save();c.translate(p.x,p.y);c.rotate(object.yaw);c.fillStyle=object.kind==='bus'?'#dfae43':object.color;c.fillRect(-object.size.x*scale/2,-object.size.z*scale/2,object.size.x*scale,object.size.z*scale);c.restore();}
  for(const sign of chunk.agents){const p=mapPoint(sign.position,center,scale,size);c.fillStyle=sign.kind==='stop'?'#d75347':sign.kind==='priority'?'#f2cf52':'#3a8997';c.beginPath();c.arc(p.x,p.y,2.7,0,Math.PI*2);c.fill();}
 }
 for(const vehicle of vehicles){const p=mapPoint(vehicle.position,center,scale,size);c.save();c.translate(p.x,p.y);c.rotate(-vehicle.yaw);c.fillStyle=vehicle.driverId===selfId?'#fffaf0':vehicle.variant==='yellow'?'#e2b541':vehicle.variant==='green'?'#35a78a':'#529fc4';c.strokeStyle='#254c55';c.lineWidth=1.5;c.beginPath();c.moveTo(0,-6);c.lineTo(4,5);c.lineTo(0,3);c.lineTo(-4,5);c.closePath();c.fill();c.stroke();c.restore();}
 c.restore();c.fillStyle='#254c55';c.font='bold 10px system-ui';c.fillText('С',8,14);
}
