import { test } from "node:test";
import assert from "node:assert/strict";
import { Budget } from "../src/game/world/budget.ts";

test("8% working cap holds even when server allows more than the hard 10%", () => {
  const b = new Budget(1000, 900);
  b.add("a", 80);
  assert.throws(() => b.add("b", 1), /BUDGET/);
  assert.equal(b.bytes, 80);
  assert.equal(b.limit, 80);
  assert.equal(b.total, 1000);
});
test("server cap includes metadata before retaining chunks", () => {
  const b = new Budget(1000, 60, 20);
  assert.equal(b.bytes, 20);
  b.add("a", 40);
  assert.throws(() => b.add("b", 1), /BUDGET/);
  b.remove("a");
  assert.equal(b.bytes, 20);
  assert.throws(() => new Budget(1000, 60, 61), /BUDGET/);
});
test("replacement is atomic and failed replacement retains the previous size", () => {
  const b = new Budget(1000, 80);
  b.add("a", 50);
  b.add("a", 60);
  assert.throws(() => b.add("a", 81));
  assert.equal(b.bytes, 60);
  b.remove("a");
  b.add("b", 80);
  assert.equal(b.bytes, 80);
});
test("rejects invalid accounting inputs instead of inventing a denominator", () => {
  for (const value of [0, -1, NaN, Infinity, 1.5]) {
    assert.throws(() => new Budget(value, 80));
    assert.throws(() => new Budget(1000, value));
  }
  for (const value of [-1, NaN, Infinity, 1.5]) {
    assert.throws(() => new Budget(1000, 80, value));
    assert.throws(() => new Budget(1000, 80).add("a", value));
  }
});

test("descriptor metadata shares the cap with chunks without ID collisions", () => {
  const b = new Budget(1000, 80, 10);
  b.add("interest", 30);
  b.setDescriptorBytes(40);
  assert.equal(b.bytes, 80);
  assert.throws(() => b.setDescriptorBytes(41), /BUDGET/);
  assert.equal(b.bytes, 80);
  assert.throws(() => b.add("interest", 31), /BUDGET/);
  b.setDescriptorBytes(0);
  assert.equal(b.bytes, 40);
  b.remove("interest");
  assert.equal(b.bytes, 10);
});
