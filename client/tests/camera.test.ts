import { test } from "node:test";
import assert from "node:assert/strict";
import { rebaseLookYaw } from "../src/game/camera.ts";
test("enter preserves world heading while converting to vehicle-relative yaw", () => {
  assert.equal(rebaseLookYaw(1.5, 0, 1), 0.5);
});
test("exit preserves heading of a turned vehicle", () => {
  assert.equal(rebaseLookYaw(0.25, 1, 0), 1.25);
});
