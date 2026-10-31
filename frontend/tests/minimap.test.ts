import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mapPoint} from '../src/ui/minimap.ts';
test('minimap keeps north up and centres on current player without a full-world map',()=>{
 assert.deepEqual(mapPoint({x:32,z:32},{x:32,z:32},2,180),{x:90,y:90});
 assert.deepEqual(mapPoint({x:42,z:22},{x:32,z:32},2,180),{x:110,y:70});
});
