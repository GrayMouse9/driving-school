import { test } from "node:test";
import assert from "node:assert/strict";
import { Streamer } from "../src/world/streamer.ts";
const meta = {
  version: "test",
  totalWorldBytes: 1000,
  cacheBudgetBytes: 80,
  accounting: "canonical-uncompressed-unique-world-data",
};
const chunk = (id: string, bytes = 50) => ({
  id,
  version: 1,
  origin: { x: 0, z: 0 },
  size: 32,
  accountedBytes: bytes,
  resources: [],
  objects: [],
  roads: [],
  agents: [],
});
test("evicts before fetching replacement and never retains both chunks", async () => {
  const old = globalThis.fetch;
  const events: string[] = [];
  const errors: string[] = [];
  globalThis.fetch = async (url) => {
    const id = String(url).split("/").at(-1)!;
    events.push(`fetch:${id}`);
    return Response.json(chunk(id));
  };
  try {
    const s = new Streamer(
      meta,
      (c) => events.push(`mount:${c.id}`),
      (id) => events.push(`dispose:${id}`),
      (m) => errors.push(m),
    );
    await s.interest(["a"], [], 80);
    await s.interest(["b"], ["a"], 80);
    assert.deepEqual(events, [
      "fetch:a",
      "mount:a",
      "dispose:a",
      "fetch:b",
      "mount:b",
    ]);
    assert.equal(s.budget.bytes, 50);
    assert.equal(s.count, 1);
    s.clear();
    assert.equal(s.budget.bytes, 0);
    assert.equal(s.count, 0);
    assert.deepEqual(errors, []);
  } finally {
    globalThis.fetch = old;
  }
});
test("oversized chunk never mounts", async () => {
  const old = globalThis.fetch;
  const mounted: string[] = [];
  const errors: string[] = [];
  globalThis.fetch = async () => Response.json(chunk("a", 81));
  try {
    const s = new Streamer(
      meta,
      (c) => mounted.push(c.id),
      () => {},
      (m) => errors.push(m),
    );
    await s.interest(["a"], [], 80);
    assert.deepEqual(mounted, []);
    assert.equal(s.budget.bytes, 0);
    assert.match(errors[0], /WORLD_BUDGET_EXCEEDED/);
  } finally {
    globalThis.fetch = old;
  }
});
test("late response from an obsolete interest cannot mount or consume budget", async () => {
  const old = globalThis.fetch;
  let finish!: (r: Response) => void;
  const mounted: string[] = [];
  globalThis.fetch = async (url) =>
    String(url).endsWith("/a")
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : Response.json(chunk("b"));
  try {
    const s = new Streamer(
      meta,
      (c) => mounted.push(c.id),
      () => {},
      () => {},
    );
    const first = s.interest(["a"], [], 80);
    await s.interest(["b"], [], 80);
    finish(Response.json(chunk("a")));
    await first;
    assert.deepEqual(mounted, ["b"]);
    assert.equal(s.budget.bytes, 50);
  } finally {
    globalThis.fetch = old;
  }
});
