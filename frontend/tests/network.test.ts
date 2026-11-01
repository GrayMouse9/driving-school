import { test } from "node:test";
import assert from "node:assert/strict";
import { Network } from "../src/network/api.ts";
test("denied cookie session never opens a WebSocket", async () => {
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ error: { message: "Войдите" } }), {
      status: 401,
    });
  };
  try {
    const network = new Network();
    await assert.rejects(network.connect(), /Войдите/);
    assert.equal(calls, 1);
    assert.equal(network.ready, false);
    assert.equal(network.send("player.input", {}), false);
  } finally {
    globalThis.fetch = old;
  }
});
test("disconnect invalidates an unfinished session check", async () => {
  const old = globalThis.fetch;
  let finish!: (response: Response) => void;
  globalThis.fetch = async () =>
    new Promise<Response>((resolve) => {
      finish = resolve;
    });
  try {
    const network = new Network();
    const pending = network.connect();
    network.disconnect();
    finish(Response.json({ user: { id: "p1" } }));
    await assert.doesNotReject(pending);
    assert.equal(network.ready, false);
  } finally {
    globalThis.fetch = old;
  }
});
test('v1 handshake joins once and blocks input until matching world acknowledgment', async () => {
 const oldFetch=globalThis.fetch;const oldSocket=globalThis.WebSocket;const oldLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
 const sockets:any[]=[];const requests:string[]=[];
 class Socket {static OPEN=1;readyState=1;sent:any[]=[];onopen?:()=>void;onmessage?:(e:{data:string})=>void;onclose?:()=>void;onerror?:()=>void;
 constructor(public url:string){sockets.push(this);}send(text:string){this.sent.push(JSON.parse(text));}close(){this.readyState=3;}
 message(type:string,payload:unknown,requestId?:string){this.onmessage?.({data:JSON.stringify({v:1,type,payload,requestId})});}}
 globalThis.fetch=async url=>{requests.push(String(url));return Response.json({user:{id:'p1'}});};
 Object.defineProperty(globalThis,'location',{configurable:true,value:{protocol:'http:',host:'demo.local:8080'}});
 globalThis.WebSocket=Socket as any;
 const net=new Network();
 try{await net.connect();assert.deepEqual(requests,['/api/v1/profile']);const ws=sockets[0];assert.equal(ws.url,'ws://demo.local:8080/ws');assert.equal(net.send('chat_send',{text:'before join'}),false);
 ws.onopen();assert.equal(ws.sent[0].type,'join_world');assert.ok(ws.sent[0].requestId);
 ws.message('world_joined',{selfId:'p1'});assert.equal(net.ready,true);
 net.reportTelemetry(60, 24);assert.equal(ws.sent.at(-1).type,'telemetry');assert.deepEqual(ws.sent.at(-1).payload,{fps:60,ping:24});
 const input={seq:1,throttle:1,brake:0,steer:0,moveX:0,moveZ:0,lookYaw:0};assert.equal(net.input(input),false);
 ws.message('world_interest',{revision:2});ws.message('world_load_status',{revision:1,ready:true});assert.equal(net.input(input),false);
 net.send('world_loaded',{revision:2,chunkIds:['c1']},'loaded-2');ws.message('world_load_status',{revision:2,ready:true},'old-ack');assert.equal(net.input(input),false);ws.message('world_load_status',{revision:2,ready:true},'loaded-2');assert.equal(net.input(input),true);assert.equal(ws.sent.at(-1).type,'player_input');assert.deepEqual(Object.keys(ws.sent.at(-1).payload).sort(),['brake','seq','steer','throttle']);
 ws.message('world_interest',{revision:3});assert.equal(net.input({...input,seq:2}),false);
 net.disconnect();assert.equal(net.ready,false);assert.equal(net.input(input),false);
 }finally{net.disconnect();globalThis.fetch=oldFetch;globalThis.WebSocket=oldSocket;if(oldLocation)Object.defineProperty(globalThis,'location',oldLocation);else delete (globalThis as any).location;}
});
