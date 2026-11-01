// HTTP/WS teaching fixtures exercise the client, not server grading or a real lesson.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {Browser} from 'playwright';
import type {Chunk} from '../src/game/world/types';
import type {Player, Vehicle, Vec3} from '../src/game/entities/types';
import {personalSceneFixture} from './teaching-fixtures';

export async function verifyTrainingScenes(browser: Browser, base: string) {
 const world=JSON.parse(readFileSync(new URL('../../server-data/world/training-world.json',import.meta.url),'utf8')) as {
  version:string; chunks:Chunk[]; spawnPoints:(Vec3 & {yaw:number})[];
 };
 const central=world.chunks.find(c=>c.id==='c_0_0')!;
 const refs=world.chunks.map(c=>({id:c.id,version:c.version,dataBytes:Buffer.byteLength(JSON.stringify(c)),resources:[]}));
 const totalWorldBytes=refs.reduce((sum,c)=>sum+c.dataBytes,0)+Buffer.byteLength(JSON.stringify({version:world.version,chunks:refs}));
 const cacheBudgetBytes=Math.floor(totalWorldBytes*.08);
 const scenes=[{role:'P'},{role:'K'},{role:'P',kind:'crosswalk'},{role:'K',kind:'stop'}] as const;
 for(const viewport of [{width:1365,height:900},{width:1280,height:720}])for(const scenario of scenes){
  const {role}=scenario;
  const personal='kind' in scenario?personalSceneFixture(scenario.kind,world.chunks):undefined;
  const chunk=personal?.chunk??central,raw=JSON.stringify(chunk),dataBytes=Buffer.byteLength(raw);
  const page=await browser.newPage({viewport});
  const errors:string[]=[],external:string[]=[];
  page.on('pageerror',error=>errors.push(String(error)));
  page.on('request',request=>{if(new URL(request.url()).origin!==new URL(base).origin)external.push(request.url());});
  try {
   const players:Player[]=personal?[{id:role,username:role==='P'?'П':'К',position:{x:personal.spawn.x,y:personal.spawn.y,z:personal.spawn.z},yaw:personal.spawn.yaw,mode:'driving',vehicleId:'personal-car'}]:world.spawnPoints.slice(0,2).map((p,i)=>({id:i?'k':'p',username:i?'К':'П',position:{x:p.x,y:p.y,z:p.z},yaw:p.yaw,mode:'driving',vehicleId:i?'vk':'vp'}));
   const vehicles:Vehicle[]=players.map((p,i)=>({id:p.vehicleId!,driverId:p.id,variant:i?'green':'blue',controller:'player',position:p.position,yaw:p.yaw,speed:0}));
   const self=players[personal||role==='P'?0:1];
   const progress={lessons:[],learnedTopics:[],mistakes:[]};
   await page.route('**/api/v1/profile',r=>r.fulfill({json:{user:{id:self.id,username:role},progress}}));
   await page.route('**/api/v1/auth/login',r=>r.fulfill({json:{user:{id:self.id,username:role}}}));
   await page.route('**/api/v1/world/manifest',r=>r.fulfill({json:{version:world.version,totalWorldBytes,cacheBudgetBytes,accounting:'utf8-uncompressed-json-plus-unique-assets'}}));
   await page.route(`**/api/v1/world/chunks/${chunk.id}`,r=>r.fulfill({contentType:'application/json',body:raw}));
   await page.routeWebSocket('**/ws',ws=>{
    const send=(type:string,payload:unknown,requestId?:string)=>ws.send(JSON.stringify({v:1,type,payload,requestId}));
    ws.onMessage(data=>{
     const m=JSON.parse(String(data));
     if(m.type==='join_world'){
      send('world_joined',{selfId:self.id,tickRate:20,player:self,vehicles,progress,episode:null,activeTask:null},m.requestId);
      send('players_snapshot',{tick:1,serverTime:Date.now(),ackInputSeq:0,players,vehicles,pedestrians:[],signals:[]});
      send('world_interest',{revision:1,worldVersion:world.version,chunks:[{id:chunk.id,version:chunk.version,dataBytes,resources:[]}],removeChunkIds:[],cacheBudgetBytes});
     }
     if(m.type==='world_loaded'){
      send('world_load_status',{revision:1,ready:true},m.requestId);
      send('task_started',personal?.task??{
       lessonId:'shared-priority',taskId:`shared-${role}`,kind:'choice',title:`Общий перекрёсток · ${role}`,
       prompt:'Кому Вы обязаны уступить дорогу при повороте налево?',scenarioId:`shared-priority-${role.toLowerCase()}`,
       episodeId:null,sceneRevision:1,role,sourceLabel:role==='P'?'На основе билета №1, вопроса №15':'На основе билета №16, вопроса №15',
       helperNpcId:role==='P'?'shared-priority-sign':'shared-yield-sign',
       options:[{id:'a1',text:'Только автобусу'},{id:'a2',text:'Только легковому автомобилю'},{id:'a3',text:role==='P'?'Никому':'Обоим транспортным средствам'}],
      });
      if(!personal)send('episode_state',{episodeId:'shared-fixture',scenarioId:'shared-priority',sceneRevision:1,phase:'paused',participants:[{playerId:self.id,role,ready:false}],selfRole:role,selfAnswerCorrect:false,activeDriver:null});
      for(let i=0;i<8;i++)send('chat_message',{senderId:'peer',username:'Участник',text:`Сообщение ${i}: проверяем читаемость перекрёстка при заполненном чате.`,serverTime:Date.now()});
     }
    });
   });
   await page.goto(base);
   await page.locator('#pull-rat').focus();await page.keyboard.press('Enter');
   await page.locator('#auth input[name="username"]').fill(role);
   await page.locator('#auth input[name="password"]').fill('password123');
   await page.locator('#auth button').first().click();
   await page.locator('#task').waitFor({state:'visible'});
   await page.waitForFunction(label=>document.getElementById('minimap')?.getAttribute('aria-label')?.includes(label),personal?(scenario.kind==='stop'?'STOP':'Переход'):'Автобус');
   assert.equal(await page.locator('#navigation').isVisible(),true,`Role ${role} at ${viewport.width}: map visible with question`);
   const summary=await page.locator('#minimap').getAttribute('aria-label');
   if(!personal){
    assert.match(summary??'',/Автобус/);
    assert.match(summary??'',/Главная.*юг.*запад/);
    assert.match(summary??'',/П.*К/);
    assert.equal(await page.locator('#episode-leave').isVisible(),true,'An active card must not hide the way to leave an episode');
    assert.equal(await page.locator('#episode-ready').isVisible(),true,'A paused episode must keep readiness available');
   }
   if('kind' in scenario && scenario.kind==='stop')assert.match(summary??'',/А.*Б.*В/,'All STOP positions must be identifiable even if the foreground marker hides the others in 3D');
   const task=await page.locator('#task').boundingBox(),map=await page.locator('#navigation').boundingBox();
   assert.ok(task && map);
   assert.ok(task.x+task.width<=map.x || map.x+map.width<=task.x || task.y+task.height<=map.y || map.y+map.height<=task.y,'Question must not cover map');
   const chat=await page.locator('#chat').boundingBox();
   assert.ok(chat && map.y+map.height<=chat.y,'A populated chat must not cover the junction overview');
   if(!personal)assert.equal(await page.locator('#episode-ready').isEnabled(),true);
   for(const selector of [...(personal?[]:['#episode-leave','#episode-ready']),'#task-prompt','#task-options button','#task-helper']){
    const elements=page.locator(selector);
    for(let i=0;i<await elements.count();i++){
     await elements.nth(i).scrollIntoViewIfNeeded();
     const hit=await elements.nth(i).evaluate(el=>{
      const r=el.getBoundingClientRect();const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return {usable:!!top&&(top===el||el.contains(top)),cover:top?.outerHTML.slice(0,180),bounds:{x:r.x,y:r.y,width:r.width,height:r.height}};
     });
     assert.equal(hit.usable,true,`${role} ${viewport.width} ${selector}[${i}]: ${JSON.stringify(hit)}`);
    }
   }
   await page.screenshot({path:`/tmp/hahaton-sh1-${personal?scenario.kind:role}-${viewport.width}.png`});
   await page.click('#task-helper');
   await page.locator('#talk').waitFor({state:'visible'});
   const talk=await page.locator('#talk').boundingBox();
   assert.ok(talk && talk.x>=task.x+task.width && talk.x+talk.width<=map.x,'Helper must not cover the question or overview');
   await page.click('#close-talk');
   assert.equal(await page.evaluate(()=>document.pointerLockElement===null),true);
   assert.equal(await page.locator('#speed').count(),0);
   assert.deepEqual(errors,[]);
   assert.deepEqual(external,[]);
  } finally {await page.close();}
 }
 console.log('PASS: all three actual server intersections and four teaching-card fixtures at 1365x900 and 1280x720; map and usable question together. No server routes or grading verified.');
}
