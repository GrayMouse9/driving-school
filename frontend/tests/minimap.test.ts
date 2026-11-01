import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mapPoint, drawMinimap} from '../src/ui/minimap.ts';
import type {Chunk} from '../src/game/world/types.ts';
test('minimap keeps north up and centres on current player without a full-world map',()=>{
 assert.deepEqual(mapPoint({x:32,z:32},{x:32,z:32},2,180),{x:90,y:90});
 assert.deepEqual(mapPoint({x:42,z:22},{x:32,z:32},2,180),{x:110,y:70});
});

test('minimap identifies static bus, both drivers and main-road arms and clears removed content',()=>{
 const labels:string[]=[];
 const positions:{text:string;x:number;y:number}[]=[];
 const context=new Proxy({fillText(text:string,x:number,y:number){labels.push(text);positions.push({text,x,y});},measureText(text:string){return {width:text.length*6};}}, {get(target,key){return key in target?target[key as keyof typeof target]:()=>{};}});
 const canvas={width:224,height:224,getContext:()=>context,setAttribute(name:string,value:string){(this as any)[name]=value;}} as unknown as HTMLCanvasElement;
 const chunk:Chunk={id:'central',version:1,origin:{x:0,z:0},size:64,resources:[],roads:[],objects:[{id:'bus',kind:'bus',position:{x:14,y:0,z:34.5},yaw:-Math.PI/2,size:{x:2.5,y:3,z:8.5},color:'#f1c45b'}],agents:[{id:'priority',kind:'priority',position:{x:38.5,y:0,z:44},yaw:0,mainRoadArms:['south','west']}]};
 const players=[{id:'p',username:'П',position:{x:34.5,y:0,z:50},yaw:0,mode:'driving' as const,vehicleId:'vp'},{id:'k',username:'К',position:{x:29.5,y:0,z:14},yaw:Math.PI,mode:'driving' as const,vehicleId:'vk'}];
 const vehicles=players.map(p=>({id:p.vehicleId,driverId:p.id,variant:'blue',position:p.position,yaw:p.yaw,speed:0}));
 drawMinimap(canvas,[chunk],players,vehicles,'p');
 assert.ok(labels.includes('Автобус'));
 assert.ok(labels.includes('П') && labels.includes('К'));
 assert.ok(labels.includes('Главная: юг, запад'));
 assert.match((canvas as any)['aria-label'],/Автобус/);
 const teachingLabels=positions.filter(p=>p.text!=='С');
 for(let i=0;i<teachingLabels.length;i++)for(let j=i+1;j<teachingLabels.length;j++){
  const a=teachingLabels[i],b=teachingLabels[j];
  assert.ok(Math.abs(a.y-b.y)>=13 || Math.abs(a.x-b.x)>=(a.text.length+b.text.length)*3+4,`${a.text} must not overlap ${b.text}`);
 }
 labels.length=0;
 drawMinimap(canvas,[],[players[0]],[vehicles[0]],'p');
 assert.ok(!labels.includes('Автобус'));
 assert.doesNotMatch((canvas as any)['aria-label'],/Автобус|Главная|К/);
});

test('STOP teaching markers remain identifiable on the map when cockpit labels overlap',()=>{
 const labels:string[]=[];
 const context=new Proxy({fillText(text:string){labels.push(text);},measureText(text:string){return {width:text.length*6};}}, {get(target,key){return key in target?target[key as keyof typeof target]:()=>{};}});
 let summary='';
 const canvas={width:224,getContext:()=>context,setAttribute(_name:string,value:string){summary=value;}} as unknown as HTMLCanvasElement;
 const chunk:Chunk={id:'stop',version:1,origin:{x:0,z:-64},size:64,resources:[],roads:[],objects:[],agents:[],teaching:{paths:[],zones:[],signals:[],markers:[
  {id:'stop-a',label:'А',position:{x:34.5,y:0,z:-11}},
  {id:'stop-b',label:'Б',position:{x:34.5,y:0,z:-18}},
  {id:'stop-v',label:'В',position:{x:34.5,y:0,z:-24}},
 ]}};
 drawMinimap(canvas,[chunk],[{id:'self',username:'К',position:{x:34.5,y:0,z:-4},yaw:0,mode:'driving',vehicleId:'car'}],[],'self');
 for(const label of ['А','Б','В'])assert.ok(labels.includes(label),`Map must identify marker ${label}`);
 assert.match(summary,/А.*Б.*В/);
});

test('map labels fit wide names and do not pin offscreen objects to its edge',()=>{
 const drawn:{text:string;x:number}[]=[];let summary='';
 const context=new Proxy({fillText(text:string,x:number){drawn.push({text,x});},measureText(text:string){return {width:text.length*10};}}, {get(target,key){return key in target?target[key as keyof typeof target]:()=>{};}});
 const canvas={width:224,getContext:()=>context,setAttribute(_name:string,value:string){summary=value;}} as unknown as HTMLCanvasElement;
 const name='Ж'.repeat(40);
 const players=[{id:'self',username:name,position:{x:0,y:0,z:0},yaw:0,mode:'driving' as const,vehicleId:'self-car'},{id:'far',username:'Далёкий игрок',position:{x:1000,y:0,z:1000},yaw:0,mode:'driving' as const,vehicleId:'far-car'}];
 const vehicles=players.map(p=>({id:p.vehicleId,driverId:p.id,variant:'blue',position:p.position,yaw:p.yaw,speed:0}));
 drawMinimap(canvas,[],players,vehicles,'self');
 assert.doesNotMatch(summary,/Далёкий игрок/);
 assert.match(summary,new RegExp(name));
 for(const p of drawn.filter(p=>p.text!=='С')){
  const half=p.text.length*5;
  assert.ok(p.x-half>=3&&p.x+half<=221,'Rendered label must fit inside the map');
 }
 assert.ok(drawn.some(p=>p.text.endsWith('…')),'A long label should be visibly shortened');
});
