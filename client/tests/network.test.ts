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
