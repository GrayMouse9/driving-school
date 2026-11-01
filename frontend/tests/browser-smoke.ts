// Production browser verification. HTTP and WS below are explicitly fixtures, not a backend.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {verifyTrainingScenes} from './training-scenes';
import {previewChunk} from '../src/game/world/preview';
const base=process.env.CLIENT_URL??'http://localhost:4173';
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--enable-unsafe-swiftshader']});
try{
 await verifyTrainingScenes(browser,base);
 const page=await browser.newPage({viewport:{width:1440,height:900}});const errors:string[]=[],external:string[]=[];const sent:any[]=[];
 await page.addInitScript(()=>{window.addEventListener('game:state',e=>{(window as any).__clientState=(e as CustomEvent).detail;});window.addEventListener('game:server',e=>{(window as any).__lastServer=(e as CustomEvent).detail;});});
 page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
 await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 await page.goto(base);
 assert.equal(await page.locator('#preview, #reconnect, #speed').count(),0);
 assert.equal(await page.locator('#logout').isVisible(),false);
 await page.locator('#pull-rat').focus();await page.keyboard.press('Enter');
 await page.locator('#auth input[name="username"]').waitFor({state:'visible'});
 await page.evaluate(()=>{(window as any).__arrowDefaults=[];window.addEventListener('keydown',e=>{if(e.code.startsWith('Arrow'))(window as any).__arrowDefaults.push(e.defaultPrevented);});});
 const authRequests:{action:string;credentials:unknown}[]=[];let rejectLogin=true;
 await page.route('**/api/v1/auth/*',r=>{
  const action=new URL(r.request().url()).pathname.split('/').at(-1)!;
  authRequests.push({action,credentials:r.request().postDataJSON()});
  if(action==='login'&&rejectLogin)return r.fulfill({status:401,json:{error:{message:'Неверные реквизиты'}}});
  return r.fulfill({status:action==='register'?201:action==='logout'?204:200,...(action==='logout'?{}:{json:{user:{id:'p1',username:'Тест'}}})});
 });
 await page.click('#open-register');
 await page.locator('#reg-form input[name="username"]').fill('Тест');
 await page.locator('#reg-form input[name="password"]').fill('short');
 await page.locator('#reg-form input[name="password2"]').fill('short');
 await page.locator('#reg-form button[type="submit"]').click();
 await page.locator('#reg-notice').filter({hasText:'от 8 до 15'}).waitFor();assert.equal(authRequests.length,0);
 await page.locator('#reg-form input[name="password"]').fill('TestRoad26');
 await page.locator('#reg-form input[name="password2"]').fill('TestRoad26');
 await page.locator('#reg-form button[type="submit"]').click();await page.locator('#reg-notice').filter({hasText:'Аккаунт создан'}).waitFor();
 assert.deepEqual(authRequests.at(-1),{action:'register',credentials:{username:'Тест',password:'TestRoad26'}});
 await page.locator('#register-modal').waitFor({state:'hidden'});
 await page.locator('#auth input[name="password"]').fill('TestRoad26');
 await page.locator('#auth button').first().click();await page.locator('#notice').filter({hasText:'Неверные реквизиты'}).waitFor();
 assert.equal(await page.locator('#login').isVisible(),true);
 await page.route('**/api/v1/profile',r=>r.fulfill({json:{user:{id:'p1',username:'Тест'},progress:{lessons:[],learnedTopics:[],mistakes:[]}}}));
 const fixture=previewChunk();fixture.id='test-chunk';delete fixture.accountedBytes;
 fixture.teaching={paths:[{id:'path-p',points:[{x:2.5,y:.1,z:8},{x:2.5,y:.1,z:-8}]}],zones:[{id:'stop-line',kind:'stop',outline:[{x:0,y:.1,z:-5},{x:5,y:.1,z:-5},{x:5,y:.1,z:-6},{x:0,y:.1,z:-6}]}],signals:[{id:'light-1',position:{x:-6,y:0,z:-5},yaw:0}]};
 const raw=JSON.stringify(fixture),dataBytes=new TextEncoder().encode(raw).byteLength;
 await page.route('**/api/v1/world/manifest',r=>r.fulfill({json:{version:'test',totalWorldBytes:100000,cacheBudgetBytes:8000,accounting:'utf8-uncompressed-json-plus-unique-assets'}}));
 await page.route('**/api/v1/world/chunks/test-chunk',r=>r.fulfill({contentType:'application/json',body:raw}));
 const player={id:'p1',username:'Тест',position:{x:2.5,y:0,z:8},yaw:0,mode:'driving',vehicleId:'v1'};
 const remote={...player,id:'p2',username:'Другая ученица',vehicleId:'v2'};
 let vehicles=[{id:'v1',driverId:'p1',variant:'blue',controller:'player',position:player.position,yaw:0,speed:0},{id:'v2',driverId:'p2',variant:'green',controller:'player',position:{x:-2.5,y:0,z:-4},yaw:0,speed:0},{id:'bus-test',driverId:null,variant:'bus',controller:'npc',position:{x:-2.5,y:0,z:-25},yaw:0,speed:0}];
 const task={lessonId:'lesson-p',taskId:'task-p',kind:'choice',title:'Главная дорога',prompt:'Кому Вы обязаны уступить?',scenarioId:'shared-priority-p',episodeId:'e1',sceneRevision:1,role:'P',sourceLabel:'На основе билета №1, вопроса №15',helperNpcId:'preview-yield',options:[{id:'a1',text:'Только автобусу'},{id:'a3',text:'Никому'}]};
 let askCount=0;let delayedReply:(()=>void)|undefined;
 let serverSend:(type:string,payload:unknown,requestId?:string)=>void=()=>{throw new Error('Fixture socket not connected');};
 let closeSocket:()=>void=()=>{throw new Error('Fixture socket not connected');};
 let restoredTask:typeof task|null=null;
 let holdReplies=false;const heldReplies:(()=>void)[]=[];
 await page.routeWebSocket('**/ws',ws=>{
  const send=(type:string,payload:unknown,requestId?:string)=>ws.send(JSON.stringify({v:1,type,payload,requestId}));
  serverSend=send;
  closeSocket=()=>ws.close();
  const episode=(phase:string,selfAnswerCorrect=false)=>({episodeId:'e1',scenarioId:'shared-priority',sceneRevision:1,phase,participants:[{playerId:'p1',role:'P',ready:true},{playerId:'p2',role:'K',ready:true}],selfRole:'P',selfAnswerCorrect,activeDriver:null});
  const snapshot=(tick:number)=>send('players_snapshot',{tick,serverTime:Date.now(),ackInputSeq:0,players:[player,remote],vehicles,pedestrians:[{id:'walker',position:{x:-4,y:0,z:-15},yaw:0,moving:false}],signals:[{id:'light-1',aspect:'green'}]});
  ws.onMessage(data=>{const m=JSON.parse(String(data));sent.push(m);
   if(m.type==='join_world'){
    send('world_joined',{selfId:'p1',tickRate:20,player,vehicles,progress:{lessons:[],learnedTopics:[],mistakes:[]},episode:null,activeTask:restoredTask},m.requestId);
    send('world_interest',{revision:1,worldVersion:'test',chunks:[{id:fixture.id,version:1,dataBytes,resources:[]}],removeChunkIds:[],cacheBudgetBytes:8000});snapshot(1);
   }
   if(m.type==='world_loaded')send('world_load_status',{revision:m.payload.revision,ready:true},m.requestId);
   if(m.type==='chat_send'){send('action_result',{action:'chat_send',ok:true},m.requestId);send('chat_message',{senderId:'p1',username:'Тест',text:m.payload.text,serverTime:Date.now()});}
   if(m.type==='episode_join'){send('episode_state',episode('answering'),m.requestId);send('task_started',task);}
   if(m.type==='answer_submit'){
    const correct=m.payload.answerId==='a3';send('answer_result',{lessonId:task.lessonId,taskId:task.taskId,correct,stage:'choice',mistakeKind:correct?null:'answer',explanation:correct?'Ответ принят':'Ты находишься справа от автобуса.',nextTaskId:null},m.requestId);
    if(correct){send('episode_state',episode('completed',true));vehicles=vehicles.filter(v=>v.id!=='bus-test');snapshot(2);send('progress_updated',{progress:{lessons:[{lessonId:'lesson-p',status:'completed',attempts:2}],learnedTopics:['priority'],mistakes:[{topic:'priority',kind:'answer',count:1}]}});}
   }
   if(m.type==='npc_message'){askCount++;const reply=()=>send('npc_reply',{npcId:m.payload.npcId,name:'Уступите дорогу',text:askCount===1?'Посмотри на положение автобуса.':'Другой пример: сравни траектории.',topic:'priority',exampleId:`ex-${askCount}`,taskId:m.payload.taskId??null,sceneRevision:m.payload.sceneRevision??null,sources:[],generation:'local_llm',suggestedQuestions:[],visualHints:[{kind:'highlight',objectIds:['bus-test'],pathIds:['path-p'],zoneIds:[],durationMs:600}]},m.requestId);if(holdReplies)heldReplies.push(reply);else if(askCount===3)delayedReply=reply;else reply();}

  });
 });
 rejectLogin=false;await page.locator('#auth button').first().click();await page.locator('#connection').filter({hasText:'Подключено'}).waitFor();
 await page.waitForFunction(()=>document.getElementById('diag')?.textContent?.includes('участки: 1'));await page.waitForFunction(()=>(window as any).__clientState?.connected===true);
 assert.ok(sent.some(m=>m.type==='join_world'));
 const yaw=await page.evaluate(()=>(window as any).__clientState.vehicle.yaw);await page.mouse.move(100,100);await page.mouse.move(1200,700);
 assert.equal(await page.evaluate(()=>(window as any).__clientState.vehicle.yaw),yaw);assert.equal(await page.evaluate(()=>document.pointerLockElement===null),true);
 await page.keyboard.down('KeyW');await page.waitForTimeout(200);await page.keyboard.up('KeyW');assert.ok(sent.some(m=>m.type==='player_input'&&m.payload.throttle===1));
 await page.keyboard.down('ArrowUp');await page.keyboard.down('ArrowLeft');await page.waitForTimeout(150);await page.keyboard.up('ArrowLeft');await page.keyboard.up('ArrowUp');
 assert.ok(sent.some(m=>m.type==='player_input'&&m.payload.steer===1));
 await page.keyboard.down('ArrowDown');await page.waitForTimeout(150);await page.keyboard.up('ArrowDown');assert.ok(sent.some(m=>m.type==='player_input'&&m.payload.brake===1));
 assert.ok((await page.evaluate(()=>(window as any).__arrowDefaults)).every(Boolean),'Driving arrows must prevent page scrolling');
 await page.locator('#chat-form input').fill('<b>Привет</b>');await page.keyboard.press('ArrowLeft');assert.equal(await page.evaluate(()=>(window as any).__arrowDefaults.at(-1)),false,'Chat arrows must retain caret movement');await page.locator('#chat-form button').click();await page.locator('#chat-log').filter({hasText:'<b>Привет</b>'}).waitFor();assert.equal(await page.locator('#chat-log b').count(),0);
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('game:command',{detail:{type:'episode_join',payload:{scenarioId:'shared-priority',role:'P'}}})));await page.locator('#task').waitFor({state:'visible'});
 serverSend('answer_result',{taskId:task.taskId,correct:false,stage:'choice',explanation:'Просроченный ответ'},'unsolicited-result');
 await page.waitForFunction(()=>(window as any).__lastServer?.requestId==='unsolicited-result');
 assert.equal(await page.locator('#talk').isVisible(),false,'Rejected answer must not open a helper dialog');
 assert.equal(askCount,0);assert.doesNotMatch(await page.locator('#task-feedback').innerText(),/Просроченный/);
 await page.locator('#task-options button').filter({hasText:'Только автобусу'}).click();await page.locator('#messages').filter({hasText:'Посмотри на положение автобуса.'}).waitFor();assert.equal(askCount,1);
 await page.keyboard.down('KeyW');await page.waitForTimeout(180);await page.keyboard.up('KeyW');assert.equal(sent.filter(m=>m.type==='player_input').at(-1).payload.throttle,0);
 await page.click('#repeat');await page.locator('#messages').filter({hasText:'Другой пример'}).waitFor();assert.equal(askCount,2);
 await page.screenshot({path:'/tmp/hahaton-task-v1.png'});
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('game:command',{detail:{type:'npc_message',requestId:'external-ui-question',payload:{npcId:'preview-yield',text:'Ещё вопрос'}}})));
 await page.waitForTimeout(200);assert.equal(askCount,3);await page.keyboard.press('Escape');delayedReply?.();await page.waitForTimeout(200);assert.equal(await page.locator('#talk').isVisible(),false);

 await page.locator('#task-options button').filter({hasText:'Никому',exact:true}).click();await page.locator('#task').waitFor({state:'hidden'});await page.locator('#talk').waitFor({state:'hidden'});
 holdReplies=true;
 serverSend('task_started',{...task,taskId:'task-next',title:'Следующая карточка',sceneRevision:2,episodeId:null});
 await page.locator('#task-title').filter({hasText:'Следующая карточка'}).waitFor();
 await page.click('#task-helper');await page.waitForFunction(()=>document.getElementById('talk')?.hidden===false);
 const waitForHeldReply=async()=>{const deadline=Date.now()+5000;while(heldReplies.length===0){assert.ok(Date.now()<deadline,'Helper request was not sent within 5 seconds');await page.waitForTimeout(20);}};
 await waitForHeldReply();
 assert.match(await page.locator('#assistant-status').innerText(),/готовит ответ/);
 assert.equal(await page.locator('#repeat').isDisabled(),true);
 assert.equal(await page.locator('#ask button').isDisabled(),true);
 await page.screenshot({path:'/tmp/hahaton-helper-waiting.png'});
 const oldQuestion=sent.filter(m=>m.type==='npc_message').at(-1);
 serverSend('task_started',{...task,taskId:'task-third',title:'Новая постановка',sceneRevision:3,episodeId:null});
 await page.locator('#task-title').filter({hasText:'Новая постановка'}).waitFor();
 assert.equal(await page.locator('#talk').isVisible(),false,'A new task must close the previous task dialog');
 assert.equal(await page.locator('#messages').innerText(),'','A new task must clear the previous task history');
 heldReplies.shift()!();await page.waitForFunction(id=>(window as any).__lastServer?.requestId===id,oldQuestion.requestId);
 assert.equal(await page.locator('#talk').isVisible(),false);assert.equal(await page.locator('#messages').innerText(),'');
 await page.click('#task-helper');
 await waitForHeldReply();
 const currentQuestion=sent.filter(m=>m.type==='npc_message').at(-1);
 const unsafeText='<img src=x onerror=alert(1)> Правило объясняется текстом.';
 serverSend('npc_reply',{npcId:'foreign-helper',taskId:'task-third',sceneRevision:3,name:'Чужой',text:'Чужая история',visualHints:[]},currentQuestion.requestId);
 await page.waitForFunction(id=>(window as any).__lastServer?.requestId===id,currentQuestion.requestId);
 assert.doesNotMatch(await page.locator('#messages').innerText(),/Чужая история/);
 serverSend('npc_reply',{npcId:task.helperNpcId,taskId:'task-third',sceneRevision:3,name:'Помощник',text:unsafeText,visualHints:[]},currentQuestion.requestId);
 await page.locator('#messages').filter({hasText:unsafeText}).waitFor();assert.equal(await page.locator('#messages img').count(),0);
 assert.equal(await page.locator('#repeat').isEnabled(),true);
 const asksBeforeRetry=askCount;
 await page.click('#repeat');
 await page.waitForFunction(()=>document.querySelector<HTMLButtonElement>('#repeat')?.disabled===true);
 {const deadline=Date.now()+5000;while(askCount===asksBeforeRetry){assert.ok(Date.now()<deadline,'Retry request was not sent');await page.waitForTimeout(20);}}
 const failedQuestion=sent.filter(m=>m.type==='npc_message').at(-1);
 serverSend('server_error',{code:'AI_UNAVAILABLE',message:'Помощник временно недоступен',retryable:true},failedQuestion.requestId);
 await page.locator('#assistant-status').filter({hasText:'Помощник временно недоступен'}).waitFor();
 assert.equal(await page.locator('#repeat').isEnabled(),true);
 assert.equal(await page.locator('#ask button').isEnabled(),true);
 await page.screenshot({path:'/tmp/hahaton-helper-unavailable.png'});
 await page.locator('#task-options button').filter({hasText:'Только автобусу',exact:true}).click();
 assert.equal(await page.locator('#task-options button').first().isDisabled(),true);
 const answersBeforeReconnect=sent.filter(m=>m.type==='answer_submit').length;
 restoredTask={...task,taskId:'restored-task',title:'Восстановленное задание',sceneRevision:4};
 closeSocket();await page.locator('#login').waitFor({state:'visible'});
 assert.equal(await page.locator('#task').isVisible(),false);
 assert.equal(await page.locator('#messages').innerText(),'');
 await page.click('#reconnect');await page.locator('#task-title').filter({hasText:'Восстановленное задание'}).waitFor();
 await page.locator('#connection').filter({hasText:'Подключено'}).waitFor();
 assert.equal(await page.locator('#task-options button').first().isEnabled(),true);
 assert.equal(sent.filter(m=>m.type==='answer_submit').length,answersBeforeReconnect,'Reconnect must not replay the old answer');
 assert.doesNotMatch(await page.locator('#task-feedback').innerText(),/Ответ принят/);
 assert.equal(await page.locator('#talk').isVisible(),false);
 serverSend('npc_reply',{npcId:task.helperNpcId,taskId:'task-third',sceneRevision:3,name:'Старый помощник',text:'Старый ответ после входа',visualHints:[]},failedQuestion.requestId);
 await page.waitForFunction(id=>(window as any).__lastServer?.requestId===id,failedQuestion.requestId);
 assert.equal(await page.locator('#messages').innerText(),'');assert.equal(await page.locator('#talk').isVisible(),false);
 await page.screenshot({path:'/tmp/hahaton-restored-task.png'});
 assert.ok(sent.every(m=>!['vehicle_exit','vehicle_enter','vehicle.exit','vehicle.enter'].includes(m.type)));
 await page.click('#logout');await page.locator('#pull-rat').focus();await page.keyboard.press('Enter');await page.locator('#notice').filter({hasText:'Вы вышли из аккаунта'}).waitFor();
 assert.equal(await page.locator('#login').isVisible(),true);assert.equal(await page.locator('#chat').isVisible(),false);
 assert.deepEqual(authRequests.map(r=>r.action),['register','login','login','logout']);
 assert.deepEqual(authRequests.at(-1)?.credentials,{});
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 console.log('PASS: production cockpit/WASD/arrows/reverse, fixed mouse, cleanup, auth, v1 handshake/world ack, snapshots, personal task, helper waiting/error/retry, stale reply rejection, safe helper/chat text, disconnect during answer, restored task without replay; no page errors/external requests.');
 console.log('HTTP/WS/LLM replies are TEST FIXTURES. Real multiplayer, server grading, persistence, LAN and offline deployment remain unverified.');
}finally{await browser.close();}
