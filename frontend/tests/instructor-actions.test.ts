import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Session} from '../src/game/interactions/session.ts';
import {bindTaskView} from '../src/ui/tasks.ts';

test('answer buttons live in the instructor dialog and S still requires a separate continuation',t=>{
 const nodes:Record<string,any>={};
 function element(){return {hidden:false,disabled:false,textContent:'',children:[] as any[],replaceChildren(){this.children=[];},append(child:any){this.children.push(child);}};}
 for(const id of ['instructor-actions','episode-status','episode-ready'])nodes[id]=element();
 const original=Object.getOwnPropertyDescriptor(globalThis,'document');
 t.after(()=>{if(original)Object.defineProperty(globalThis,'document',original);else Reflect.deleteProperty(globalThis,'document');});
 Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:(id:string)=>{assert.ok(nodes[id],`removed widget accessed: ${id}`);return nodes[id];},createElement:element}});
 const sent:any[]=[];const session=new Session((type,payload)=>{sent.push({type,payload});return true;});
 bindTaskView(session,new Set());
 session.consume({v:1,type:'task_started',payload:{taskId:'task',kind:'choice',sceneRevision:1,helperNpcId:'coach',options:[{id:'left',text:'A — налево'},{id:'forward',text:'W — прямо'},{id:'right',text:'D — направо'},{id:'stop',text:'S — уступить'}]}});
 assert.equal(nodes['instructor-actions'].children.length,4);
 nodes['instructor-actions'].children[3].onclick();assert.equal(sent.at(-1).payload.answerId,'stop');
 session.consume({v:1,type:'trip_state',payload:{phase:'awaiting_direction',locationId:'crosswalk',sceneRevision:1,allowedActions:['right'],status:'Стоим'}});
 assert.equal(sent.filter(m=>m.type==='maneuver_choose').length,0);
 assert.equal(nodes['instructor-actions'].children.length,1);nodes['instructor-actions'].children[0].onclick();
 assert.equal(sent.at(-1).type,'maneuver_choose');assert.equal(sent.at(-1).payload.action,'right');
});
