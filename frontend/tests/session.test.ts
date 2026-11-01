import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Session} from '../src/game/interactions/session.ts';
const task={lessonId:'l1',taskId:'t1',kind:'choice',title:'Приоритет',prompt:'Кому уступить?',scenarioId:'shared-priority-p',episodeId:'e1',sceneRevision:2,role:'P',sourceLabel:'На основе билета',helperNpcId:'yield',options:[{id:'a1',text:'Автобусу'},{id:'a3',text:'Никому'}]};
const envelope=(type:string,payload:any,requestId?:string)=>({v:1 as const,type,payload,requestId});
test('wrong answer keeps task blocked, requests one explanation, never grants local progress',()=>{
 const sent:any[]=[];const state=new Session((type,payload,id)=>{sent.push({type,payload,id});return true;});
 state.consume(envelope('task_started',task));assert.equal(state.blocked,true);
 state.answer('a1');const answerId=sent.at(-1).id;const result=envelope('answer_result',{taskId:'t1',correct:false,stage:'choice',mistakeKind:'answer',explanation:'Ошибка',nextTaskId:null},answerId);state.consume(result);state.consume(result);
 assert.equal(sent.filter(m=>m.type==='npc_message').length,1);assert.equal(sent.at(-1).payload.taskId,'t1');assert.equal(state.task?.taskId,'t1');assert.equal(state.progress,undefined);
});
test('only matching current reply can apply scene hints',()=>{
 const sent:any[]=[];const state=new Session((type,payload,id)=>{sent.push({type,payload,id});return true;});state.consume(envelope('task_started',task));state.ask('yield','Ещё пример');let accepted:any;
 state.addEventListener('reply',e=>{accepted=(e as CustomEvent).detail;});
 state.consume(envelope('npc_reply',{npcId:'yield',taskId:'t1',sceneRevision:2,text:'wrong',visualHints:[]},'someone-else'));assert.equal(accepted,undefined);
 state.consume(envelope('task_started',{...task,taskId:'t2',sceneRevision:3}));state.consume(envelope('npc_reply',{npcId:'yield',taskId:'t1',sceneRevision:2,text:'previous attempt',visualHints:[{kind:'highlight',objectIds:['bus'],pathIds:[],zoneIds:[],durationMs:1000}]},sent[0].id));
 assert.equal(accepted.text,'previous attempt');assert.deepEqual(accepted.visualHints,[]);
});
test('completed episode releases choice card; unrelated practice remains independent',()=>{
 const state=new Session(()=>true);state.consume(envelope('task_started',task));state.consume(envelope('episode_state',{episodeId:'e1',phase:'completed'}));assert.equal(state.task,undefined);assert.equal(state.blocked,false);
 state.consume(envelope('task_started',{...task,taskId:'own-practice',episodeId:null,kind:'driving'}));state.consume(envelope('episode_state',{episodeId:'old',phase:'paused'}));assert.equal(state.blocked,false);
});
test('pending answer survives unrelated updates and stale response cannot replace accepted result',()=>{
 const sent:any[]=[];const state=new Session((type,payload,id)=>{sent.push({type,payload,id});return true;});state.consume(envelope('task_started',task));
 assert.equal(state.answer('a1'),true);const first=sent.at(-1).id;state.consume(envelope('progress_updated',{progress:{lessons:[],learnedTopics:[],mistakes:[]}}));assert.equal(state.answerPending,true);assert.equal(state.answer('a3'),false);
 state.consume(envelope('server_error',{code:'RATE_LIMITED'},first));assert.equal(state.answerPending,false);assert.equal(state.answer('a3'),true);const second=sent.at(-1).id;
 state.consume(envelope('answer_result',{taskId:'t1',correct:true,stage:'choice',nextTaskId:null},second));state.consume(envelope('answer_result',{taskId:'t1',correct:false,stage:'choice',explanation:'stale'},first));assert.equal(state.result.correct,true);
});
test('dismissing a dialog invalidates its in-flight replies',()=>{
 let id:string|undefined;const state=new Session((_t,_p,requestId)=>{id=requestId;return true;});state.consume(envelope('task_started',task));state.ask('yield','Ещё пример');let replies=0;state.addEventListener('reply',()=>replies++);state.dismiss('yield');
 state.consume(envelope('npc_reply',{npcId:'yield',taskId:'t1',sceneRevision:2,text:'late',visualHints:[]},id));assert.equal(replies,0);
});
