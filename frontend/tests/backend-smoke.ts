// REAL Go backend + PostgreSQL. No HTTP/WS routing or replacement handlers.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.BACKEND_URL??'http://localhost:18080';
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--enable-unsafe-swiftshader']});
const wait=async(check:()=>boolean|Promise<boolean>,message:string)=>{const until=Date.now()+20000;while(Date.now()<until){if(await check())return;await new Promise(r=>setTimeout(r,80));}throw new Error(message);};
try{
 const errors:string[]=[];const contexts=[];const pages=[];const frames:any[][]=[];const users:any[]=[];const accounts:{username:string;password:string}[]=[];
 const suffix=Date.now().toString(36);
 for(let i=0;i<2;i++){
  const context=await browser.newContext({viewport:{width:1365,height:900}});contexts.push(context);
  const credentials={username:`Прогон${i}-${suffix}`,password:'TestRoad26'};
  accounts.push(credentials);
  users.push({username:credentials.username});
  const page=await context.newPage();pages.push(page);frames[i]=[];
  await page.addInitScript(()=>{window.addEventListener('game:state',e=>{(window as any).__clientState=(e as CustomEvent).detail;});});
  page.on('pageerror',e=>errors.push(String(e)));page.on('websocket',ws=>ws.on('framereceived',event=>{try{frames[i].push(JSON.parse(String(event.payload)));}catch{}}));
  await page.goto(base);await page.locator('#pull-rat').focus();await page.keyboard.press('Enter');
  await page.locator('#open-register').click();await page.locator('#reg-form input[name="username"]').fill(credentials.username);await page.locator('#reg-form input[name="password"]').fill(credentials.password);await page.locator('#reg-form input[name="password2"]').fill(credentials.password);await page.locator('#reg-form button[type="submit"]').click();await page.locator('#reg-notice').filter({hasText:'Аккаунт создан'}).waitFor();await page.locator('#register-modal').waitFor({state:'hidden'});
  await page.locator('#auth input[name="username"]').fill(credentials.username);await page.locator('#auth input[name="password"]').fill(credentials.password);await page.locator('#auth button[type="submit"]').click();await wait(()=>frames[i].some(m=>m.type==='world_load_status'&&m.payload.ready===true),`Client ${i}: no world-ready acknowledgment`);
 }
 await wait(()=>frames[0].some(m=>m.type==='players_snapshot'&&m.payload.players.length>=2),'Two real clients are not visible together');
 const starts=await Promise.all(pages.map(p=>p.evaluate(()=>(window as any).__clientState?.vehicle?.position)));
 assert.ok(starts.every(Boolean));
 const forwardKeys=['KeyW','ArrowUp'],reverseKeys=['KeyS','ArrowDown'];
 await Promise.all(pages.map((p,i)=>p.keyboard.down(forwardKeys[i])));
 await wait(async()=>{const pos=await Promise.all(pages.map(p=>p.evaluate(()=>(window as any).__clientState?.vehicle?.position)));return pos.every((p,i)=>p&&Math.hypot(p.x-starts[i].x,p.z-starts[i].z)>2);},'Two clients did not move simultaneously');
 await Promise.all(pages.map((p,i)=>p.keyboard.up(forwardKeys[i])));
 await wait(async()=>{const speeds=await Promise.all(pages.map(p=>p.evaluate(()=>(window as any).__clientState?.vehicle?.speed)));return speeds.every(s=>s!==undefined&&Math.abs(s)<.05);},'Release did not stop both cars');
 const forward=await Promise.all(pages.map(p=>p.evaluate(()=>(window as any).__clientState.vehicle.position)));
 await Promise.all(pages.map((p,i)=>p.keyboard.down(reverseKeys[i])));
 await wait(async()=>{const speeds=await Promise.all(pages.map(p=>p.evaluate(()=>(window as any).__clientState?.vehicle?.speed)));return speeds.every(s=>s<-1);},'Two clients could not reverse together');
 await Promise.all(pages.map((p,i)=>p.keyboard.up(reverseKeys[i])));
 await wait(async()=>{const speeds=await Promise.all(pages.map(p=>p.evaluate(()=>(window as any).__clientState?.vehicle?.speed)));return speeds.every(s=>s!==undefined&&Math.abs(s)<.05);},'Reverse did not stop on release');
 const vehicleId=await pages[0].evaluate(()=>(window as any).__clientState.vehicle.id);
 await wait(()=>frames[1].some(m=>m.type==='players_snapshot'&&m.payload.vehicles.some((v:any)=>v.id===vehicleId&&Math.hypot(v.position.x-starts[0].x,v.position.z-starts[0].z)>2)),'Peer did not see the real movement');
 // Typing must stop the car, never become reverse; click the road to drive again.
 await pages[0].locator('#chat-form input').focus();
 await pages[0].keyboard.press('KeyW');
 await new Promise(r=>setTimeout(r,500));
 assert.ok(Math.abs(await pages[0].evaluate(()=>(window as any).__clientState.vehicle.speed))<.05);
 await pages[0].locator('#view').click({position:{x:650,y:400}});
 assert.equal(await pages[0].evaluate(()=>document.activeElement?.id),'view');
 const message=`LAN-ready-${suffix}`;await pages[0].locator('#chat-form input').fill(message);await pages[0].locator('#chat-form button').click();await pages[1].locator('#chat-log').filter({hasText:message}).waitFor();
 const saved=await pages[0].evaluate(()=>(window as any).__clientState.vehicle.position);const readyCount=frames[0].filter(m=>m.type==='world_load_status'&&m.payload.ready).length;await pages[0].reload();await pages[0].locator('#pull-rat').focus();await pages[0].keyboard.press('Enter');await pages[0].locator('#auth input[name="username"]').fill(accounts[0].username);await pages[0].locator('#auth input[name="password"]').fill(accounts[0].password);await pages[0].locator('#auth button[type="submit"]').click();await wait(()=>frames[0].filter(m=>m.type==='world_load_status'&&m.payload.ready).length>readyCount,'Reconnect did not reload world');
 await wait(async()=>{const p=await pages[0].evaluate(()=>(window as any).__clientState?.vehicle?.position);return p&&Math.hypot(p.x-saved.x,p.z-saved.z)<1;},'Reconnect did not restore the server position');
 await pages[0].waitForFunction(()=>document.getElementById('diag')?.textContent?.includes('доля:'));const diagnostics=await pages[0].locator('#diag').textContent();const share=diagnostics?.match(/доля: ([\d.]+)%/);assert.ok(share,'No cache fraction');assert.ok(Number(share[1])<=10);
 await pages[0].screenshot({path:'/tmp/hahaton-real-multiplayer.png'});
 const serverErrors=frames.flat().filter(m=>m.type==='server_error');assert.deepEqual(serverErrors,[]);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'PASS',actualBackend:base,accounts:users.map(u=>u.username),verified:['cookie sessions','two browser contexts in one world','simultaneous WASD/arrows forward/reverse; release to stop; chat focus recovery','peer movement visibility','chat','world load acknowledgments','server position reconnect'],diagnostics},null,2));
 console.log('This verifies two local browser contexts, not separate physical laptops. LLM and lesson validation are not part of this run.');
}finally{await browser.close();}
