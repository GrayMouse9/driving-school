import { test } from "node:test";
import assert from "node:assert/strict";
import { readInput, stepPreview } from "../src/game/player/control.ts";
test("W accelerates along negative Z at zero yaw", () => {
  const input = readInput(new Set(["KeyW"]), 0, 1);
  assert.equal(input.throttle, 1);
  const next = stepPreview({ x: 0, z: 0, yaw: 0, speed: 0 }, input, 0.1);
  assert.ok(next.z < 0);
  assert.equal(next.x, 0);
});
test("braking stops without reversing and delta is bounded after background tab", () => {
  const next = stepPreview(
    { x: 0, z: 0, yaw: 0, speed: 2 },
    readInput(new Set(["KeyS"]), 0, 2),
    10,
  );
  assert.ok(next.speed >= 0);
  assert.ok(Math.abs(next.z) <= 0.2);
});
test("opposite steering and movement keys cancel", () => {
  const input = readInput(new Set(["KeyW", "KeyS", "KeyA", "KeyD"]), 1, 3);
  assert.equal(input.steer, 0);
  assert.equal(input.moveX, 0);
  assert.equal(input.moveZ, 0);
});

test("space does not introduce a fifth driving control",()=>{assert.equal(readInput(new Set(["Space"]),0,1).brake,0);});

test('S reverses from standstill and releasing keys stops preview',()=>{
 let state={x:0,z:0,yaw:0,speed:0};
 for(let i=0;i<40;i++)state=stepPreview(state,readInput(new Set(['KeyS']),0,i),.05);
 assert.ok(state.z>1);assert.ok(state.speed<0&&state.speed>=-3);
 for(let i=0;i<40;i++)state=stepPreview(state,readInput(new Set(),0,40+i),.05);
 assert.equal(state.speed,0);
});
