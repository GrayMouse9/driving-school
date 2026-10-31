import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WorldConnection} from '../src/network/world.ts';
const meta=(version:string)=>({version,totalWorldBytes:100000,cacheBudgetBytes:8000,accounting:'utf8-uncompressed-json-plus-unique-assets'});
const interest=(revision:number,version='test')=>({revision,worldVersion:version,chunks:[],removeChunkIds:[],cacheBudgetBytes:8000});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
test('replacement streamer waits for old read settlement across clear and world switch',async()=>{
 const settled=deferred<void>();const events:string[]=[];let count=0;
 const world=new WorldConnection((_meta,_bytes)=>{count++;return {reservedBytes:count===1?7000:0,budget:{bytes:100,total:100000,limit:8000},clear(){events.push('clear');},whenIdle(){return count===1?settled.promise:Promise.resolve();},async interest(p:any){events.push(`install:${p.worldVersion}`);}} as any;},()=>{},()=>{},async(_signal,version)=>({meta:meta(version),bytes:100}));
 await world.interest(interest(1));world.clear();const replacement=world.interest(interest(1,'new'));await Promise.resolve();await Promise.resolve();assert.equal(count,1);assert.equal(world.reservedBytes,7000);
 settled.resolve();await replacement;assert.equal(count,2);assert.deepEqual(events,['install:test','clear','install:new']);
});
test('failed manifest is retried and reported to server for current revision',async()=>{
 let attempts=0;const failures:any[]=[];const world=new WorldConnection(()=>({budget:{bytes:100,total:100000,limit:8000},reservedBytes:0,async interest(){},clear(){},whenIdle(){return Promise.resolve();}} as any),()=>{},(type,payload)=>failures.push({type,payload}),async()=>{if(++attempts===1)throw new Error('offline');return {meta:meta('test'),bytes:100};});
 await world.interest(interest(1));assert.equal(failures[0].type,'world_load_failed');assert.equal(failures[0].payload.revision,1);assert.equal(failures[0].payload.code,'FETCH');await world.interest(interest(2));assert.equal(attempts,2);
});
