import { test } from "node:test";
import assert from "node:assert/strict";
import { Budget } from "../src/world/budget.ts";
test("rejects a retained chunk above 8% working budget and never invents denominator", () => {
  const b = new Budget(1000, 80);
  b.add("a", 50);
  assert.throws(() => b.add("b", 31));
  assert.equal(b.bytes, 50);
  b.remove("a");
  b.add("b", 31);
  assert.equal(b.bytes, 31);
});
test("server budget cannot bypass 10% hard limit; unique IDs count once", () => {
  const b = new Budget(1000, 900);
  b.add("a", 80);
  b.add("a", 80);
  assert.equal(b.bytes, 80);
  assert.throws(() => b.add("b", 21));
});
