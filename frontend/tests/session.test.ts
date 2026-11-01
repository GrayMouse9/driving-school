import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Session} from '../src/game/interactions/session.ts';
const task={lessonId:'l1',taskId:'t1',kind:'choice',title:'Приоритет',prompt:'Кому уступить?',scenarioId:'shared-priority-p',episodeId:'e1',sceneRevision:2,role:'P',sourceLabel:'На основе билета',helperNpcId:'yield',options:[{id:'a1',text:'Автобусу'},{id:'a3',text:'Никому'}]};
const envelope=(type:string,payload:any,requestId?:string)=>({v:1 as const,type,payload,requestId});
test('correct answer requests coach feedback and accepts it while the car drives',()=>{
 const sent:any[]=[];const state=new Session((type,payload,id)=>{sent.push({type,payload,id});return true;});
 state.consume(envelope('task_started',task));state.answer('a1','choice');
 state.consume(envelope('answer_result',{taskId:'t1',correct:true,stage:'choice'},'choice'));
 const feedback=sent.find(m=>m.type==='npc_message');assert.ok(feedback);assert.equal(feedback.payload.purpose,'answer_feedback');
 state.consume(envelope('trip_state',{phase:'driving',locationId:'shared-priority-p',sceneRevision:2,allowedActions:[],status:'Едем'}));
 let reply=false;state.addEventListener('reply',()=>reply=true);
 state.consume(envelope('npc_reply',{npcId:'yield',taskId:'t1',sceneRevision:2,text:'Вы на главной дороге.'},feedback.id));assert.equal(reply,true);
});
test('final maneuver completion preserves its pending explanation',()=>{
 const sent:any[]=[];const state=new Session((type,payload,id)=>{sent.push({type,payload,id});return true;});
 state.consume(envelope('task_started',task));state.answer('a1','choice');
 state.consume(envelope('answer_result',{taskId:'t1',correct:true,stage:'choice'},'choice'));
 const feedback=sent.find(m=>m.type==='npc_message');
 state.consume(envelope('trip_state',{phase:'completed',locationId:'shared-priority-p',sceneRevision:2,allowedActions:[],status:'Готово'}));
 let reply=false;state.addEventListener('reply',()=>reply=true);
 state.consume(envelope('npc_reply',{npcId:'yield',taskId:'t1',sceneRevision:2,text:'Объяснение завершённого манёвра'},feedback.id));assert.equal(reply,true);
});
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
 assert.equal(accepted,undefined,'a reply from the previous task must not alter dialog history');
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

test('duplicate task delivery preserves the pending answer and prevents a second submission',()=>{
 const sent:any[]=[];const state=new Session((type,payload,id)=>{sent.push({type,payload,id});return true;});
 state.consume(envelope('task_started',task));state.answer('a1','answer-first');
 state.consume(envelope('task_started',{...task}));
 assert.equal(state.answerPending,true);
 assert.equal(state.answer('a3','answer-second'),false);
 assert.equal(sent.filter(m=>m.type==='answer_submit').length,1);
});

test('an older revision cannot replace the current task or accept its late result',()=>{
 const state=new Session(()=>true);
 state.consume(envelope('task_started',task));state.answer('a1','old-answer');
 state.consume(envelope('task_started',{...task,sceneRevision:3}));
 assert.equal(state.consume(envelope('task_started',task)),false);
 assert.equal(state.task?.sceneRevision,3);
 assert.equal(state.consume(envelope('answer_result',{taskId:'t1',correct:true,stage:'choice'},'old-answer')),false);
 assert.equal(state.result,undefined);
});

test('only offered answers can be sent and failed transport leaves the card retryable',()=>{
 let sends=0;const state=new Session(()=>{sends++;return false;});
 state.consume(envelope('task_started',task));
 assert.equal(state.answer('not-an-option'),false);assert.equal(sends,0);
 assert.equal(state.answer('a1'),false);assert.equal(state.answerPending,false);assert.equal(state.result,undefined);
});

test('a driving result cannot bypass the outstanding choice answer',()=>{
 const state=new Session(()=>true);state.consume(envelope('task_started',task));
 assert.equal(state.consume(envelope('answer_result',{taskId:'t1',correct:true,stage:'driving'})),false);
 assert.equal(state.result,undefined);assert.equal(state.blocked,true);
});

test('helper replies require matching request, helper, task and scene revision',()=>{
 const state=new Session(()=>true);state.consume(envelope('task_started',task));
 const replies:any[]=[];state.addEventListener('reply',e=>replies.push((e as CustomEvent).detail));
 state.ask('yield','Вопрос','current');
 assert.equal(state.consume(envelope('npc_reply',{npcId:'other',taskId:'t1',sceneRevision:2,text:'foreign'},'current')),false);
 assert.equal(state.consume(envelope('npc_reply',{npcId:'yield',taskId:'t1',sceneRevision:1,text:'old revision'},'current')),false);
 assert.deepEqual(replies,[]);
 state.ask('yield','Новый вопрос','retry');
 assert.equal(state.consume(envelope('npc_reply',{npcId:'yield',taskId:'t1',sceneRevision:2,text:'current',visualHints:[]},'retry')),true);
 assert.equal(replies.length,1);assert.equal(replies[0].text,'current');
});

test('clear and a restored server task discard in-flight answers and helper requests',()=>{
 const state=new Session(()=>true);state.consume(envelope('task_started',task));
 state.answer('a1','before-disconnect');state.ask('yield','Вопрос','old-question');state.clear();
 assert.equal(state.task,undefined);assert.equal(state.answerPending,false);assert.equal(state.result,undefined);
 const progress={lessons:[{lessonId:'l1',status:'active',attempts:1}],learnedTopics:[],mistakes:[]};
 state.consume(envelope('world_joined',{activeTask:{...task,sceneRevision:3},episode:null,progress}));
 assert.equal(state.task?.sceneRevision,3);assert.deepEqual(state.progress,progress);assert.equal(state.answerPending,false);
 assert.equal(state.consume(envelope('answer_result',{taskId:'t1',correct:true,stage:'choice'},'before-disconnect')),false);
 assert.equal(state.consume(envelope('npc_reply',{npcId:'yield',taskId:'t1',sceneRevision:2,text:'late'},'old-question')),false);
 assert.equal(state.result,undefined);
});

test('one pending helper question disables a duplicate until the reply arrives',()=>{
 const sent:any[]=[];const state=new Session((type,payload,id)=>{sent.push({type,payload,id});return true;});
 state.consume(envelope('task_started',task));
 assert.equal(state.ask('yield','Объясни','q1'),'q1');
 assert.equal(state.question?.pending,true);
 assert.equal(state.ask('yield','Ещё раз','q2'),undefined);
 assert.equal(sent.length,1);
 state.consume(envelope('npc_reply',{npcId:'yield',taskId:'t1',sceneRevision:2,text:'Объяснение',visualHints:[]},'q1'));
 assert.equal(state.question?.pending,false);
 assert.equal(state.ask('yield','Другой пример','q3'),'q3');
});

test('helper failure releases waiting state and allows a new request without inventing a reply',()=>{
 const state=new Session(()=>true);state.consume(envelope('task_started',task));
 let replies=0;state.addEventListener('reply',()=>replies++);
 state.ask('yield','Объясни','q1');
 state.consume(envelope('server_error',{code:'AI_UNAVAILABLE',message:'Помощник временно недоступен'},'q1'));
 assert.equal(state.question?.pending,false);
 assert.equal(state.question?.error,'Помощник временно недоступен');
 assert.equal(replies,0);assert.equal(state.result,undefined);
 assert.equal(state.ask('yield','Попробовать снова','q2'),'q2');
 state.consume(envelope('server_error',{code:'AI_UNAVAILABLE',message:'Старая ошибка'},'q1'));
 assert.equal(state.question?.pending,true);assert.equal(state.question?.error,undefined);
});

test('failed helper transport exposes an error and dismissal clears its state',()=>{
 const state=new Session(()=>false);state.consume(envelope('task_started',task));
 assert.equal(state.ask('yield','Вопрос','q1'),undefined);
 assert.equal(state.question?.pending,false);assert.ok(state.question?.error);
 state.dismiss('yield');assert.equal(state.question,undefined);
});

test('finishing the current episode clears its pending helper but leaves unrelated practice alone',()=>{
 const state=new Session(()=>true);state.consume(envelope('task_started',task));state.ask('yield','Вопрос','q1');
 state.consume(envelope('episode_state',{episodeId:'e1',phase:'completed'}));
 assert.equal(state.question,undefined);
 assert.equal(state.consume(envelope('npc_reply',{npcId:'yield',taskId:'t1',sceneRevision:2,text:'late'},'q1')),false);
 state.consume(envelope('task_started',{...task,taskId:'personal',episodeId:null}));state.ask('yield','Личный вопрос','q2');
 state.consume(envelope('episode_state',{episodeId:'old-episode',phase:'cancelled'}));
 assert.equal(state.question?.requestId,'q2');assert.equal(state.question?.pending,true);
});

test('an incorrect answer supersedes an in-flight conditions question with one error explanation',()=>{
 const sent:any[]=[];const state=new Session((type,payload,id)=>{sent.push({type,payload,id});return true;});
 state.consume(envelope('task_started',task));state.ask('yield','Объясни условия','conditions');state.answer('a1','answer');
 const result=envelope('answer_result',{taskId:'t1',correct:false,stage:'choice',explanation:'Ошибка'},'answer');
 state.consume(result);state.consume(result);
 const questions=sent.filter(m=>m.type==='npc_message');
 assert.equal(questions.length,2,'The accepted mistake needs a new explanation even if conditions help is pending');
 assert.equal(questions[1].payload.text,'Объясни мою последнюю ошибку');
 assert.equal(state.consume(envelope('npc_reply',{npcId:'yield',taskId:'t1',sceneRevision:2,text:'old conditions'},'conditions')),false);
 assert.equal(state.question?.requestId,questions[1].id);assert.equal(state.question?.pending,true);
});

test('a stopped training car accepts one explicit continuation and never repeats it on focus or updates',()=>{
 const sent:any[]=[];const state=new Session((type,payload,id)=>{sent.push({type,payload,id});return true;});
 state.consume(envelope('trip_state',{phase:'awaiting_direction',locationId:'shared-priority-k',sceneRevision:1,allowedActions:['left'],status:'Стоим'}));
 assert.equal(state.maneuver('right'),false);assert.equal(state.maneuver('left','continue'),true);assert.equal(state.maneuver('left','duplicate'),false);
 assert.equal(sent.length,1);assert.equal(sent[0].type,'maneuver_choose');
 state.consume(envelope('trip_state',{phase:'driving',locationId:'shared-priority-k',sceneRevision:1,allowedActions:[],status:'Едем'}));
 assert.equal(state.maneuver('left'),false);assert.equal(sent.length,1);
 state.clear();assert.equal(state.motion,undefined);
});
