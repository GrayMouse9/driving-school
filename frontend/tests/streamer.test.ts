import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { WorldInterest, ChunkRef } from "../src/network/protocol.ts";
import { Streamer } from "../src/game/world/streamer.ts";

const meta = {
  version: "test", totalWorldBytes: 100000, cacheBudgetBytes: 8000,
  accounting: "utf8-uncompressed-json-plus-unique-assets",
};
const chunk = (id: string, version = 1) => ({
  id, version, origin: { x: 0, z: 0 }, size: 32,
  resources: [], objects: [], roads: [], agents: [],
});
const body = (id: string, size = 1000, version = 1) => {
  const raw = JSON.stringify(chunk(id, version));
  return raw + " ".repeat(Math.max(0, size - new TextEncoder().encode(raw).byteLength));
};
const ref = (id: string, dataBytes = 1000, version = 1): ChunkRef => ({ id, version, dataBytes, resources: [] });
const interest = (revision: number, chunks: ChunkRef[], extra: Partial<WorldInterest> = {}): WorldInterest =>
  ({ revision, worldVersion: "test", chunks, removeChunkIds: [], cacheBudgetBytes: 8000, ...extra });
const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
function fixture(metadataBytes = 100) {
  const mounted: string[] = [], disposed: string[] = [], reports: string[] = [];
  const emitted: {type: string; payload: any}[] = [];
  const s = new Streamer(meta, c => mounted.push(`${c.id}:${c.version}`), id => disposed.push(id),
    m => reports.push(m), (type, payload) => emitted.push({type, payload}), metadataBytes);
  return { s, mounted, disposed, reports, emitted };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function mockFetch(t: TestContext, fetcher: typeof fetch) { t.mock.method(globalThis, "fetch", fetcher); }
function failed(f: ReturnType<typeof fixture>, code: string, revision: number, chunkId: string | null) {
  assert.equal(f.emitted.at(-1)?.type, "world_load_failed");
  assert.deepEqual({ ...f.emitted.at(-1)!.payload, message: undefined }, { revision, code, chunkId, message: undefined });
  assert.ok(f.reports.at(-1));
}

test("reserves the whole missing batch before sequential no-store v1 fetches", async t => {
  const f = fixture(), first = deferred<Response>(), entered = deferred<void>();
  const calls: string[] = [];
  mockFetch(t, async (url, options) => {
    calls.push(String(url));
    assert.equal(options?.cache, "no-store");
    assert.equal(options?.credentials, "same-origin");
    assert.equal(f.s.reservedBytes, calls.length === 1 ? 2000 : 1000);
    if (calls.length === 1) { entered.resolve(); return first.promise; }
    return new Response(body("b"));
  });
  const message = interest(1, [ref("a/b"), ref("b")]);
  const pending = f.s.interest(message);
  await entered.promise;
  assert.equal(f.s.budget.bytes, 100 + jsonBytes(message));
  assert.deepEqual(calls, ["/api/v1/world/chunks/a%2Fb"]);
  first.resolve(new Response(body("a/b")));
  await pending;
  assert.deepEqual(f.mounted, ["a/b:1", "b:1"]);
  assert.equal(f.s.reservedBytes, 0);
  assert.equal(f.s.budget.bytes, 2100 + jsonBytes(message));
  assert.deepEqual(f.emitted, [{type: "world_loaded", payload: {revision: 1, chunkIds: ["a/b", "b"]}}]);
});

test("rejects an oversized batch including metadata before the first fetch", async t => {
  let calls = 0;
  mockFetch(t, async () => { calls++; return new Response(body("a")); });
  const f = fixture();
  await f.s.interest(interest(1, [ref("a", 4000), ref("b", 4000)]));
  assert.equal(calls, 0);
  assert.equal(f.s.budget.bytes, 100 + jsonBytes(interest(1, [ref("a", 4000), ref("b", 4000)])));
  assert.equal(f.s.reservedBytes, 0);
  failed(f, "BUDGET", 1, null);
});

test("evicts before replacement, reuses versions, and clear retains metadata", async t => {
  const f = fixture(), calls: string[] = [];
  mockFetch(t, async url => {
    const id = String(url).split("/").at(-1)!; calls.push(id);
    if (id === "b") assert.deepEqual(f.disposed, ["a"]);
    return new Response(body(id));
  });
  await f.s.interest(interest(1, [ref("a")]));
  await f.s.interest(interest(2, [ref("a")]));
  await f.s.interest(interest(3, [ref("b")], { removeChunkIds: ["a"] }));
  assert.deepEqual(calls, ["a", "b"]);
  assert.equal(f.s.count, 1);
  assert.equal(f.s.budget.bytes, 1100 + jsonBytes(interest(3, [ref("b")], {removeChunkIds: ["a"]})));
  f.s.clear();
  assert.equal(f.s.count, 0);
  assert.equal(f.s.budget.bytes, 100);
  assert.equal(f.s.reservedBytes, 0);
});

test("older and duplicate revisions cannot mount or acknowledge", async t => {
  const f = fixture(); let calls = 0;
  mockFetch(t, async () => { calls++; return new Response(body("a")); });
  await f.s.interest(interest(3, [ref("a")]));
  await f.s.interest(interest(2, [ref("b")]));
  await f.s.interest(interest(3, [ref("b")]));
  assert.equal(calls, 1);
  assert.equal(f.s.revision, 3);
  assert.deepEqual(f.mounted, ["a:1"]);
  assert.equal(f.emitted.length, 1);
});

test("aborted fetch holds its reserve until settlement and rejects an over-cap replacement", async t => {
  const f = fixture(), reply = deferred<Response>(), entered = deferred<void>();
  let signal!: AbortSignal, calls = 0;
  mockFetch(t, async (_url, options) => { calls++; signal = options!.signal!; entered.resolve(); return reply.promise; });
  const old = f.s.interest(interest(1, [ref("a", 5000)]));
  await entered.promise;
  await f.s.interest(interest(2, [ref("b", 4000)]));
  assert.equal(signal.aborted, true);
  assert.equal(f.s.reservedBytes, 5000);
  assert.equal(calls, 1);
  failed(f, "BUDGET", 2, null);
  reply.resolve(new Response(body("a", 5000)));
  await old;
  assert.equal(f.s.reservedBytes, 0);
  assert.deepEqual(f.mounted, []);
  assert.equal(f.emitted.length, 1);
});

test("stale responses cannot mount; a replacement waits for the active fetch", async t => {
  const f = fixture(), reply = deferred<Response>(), entered = deferred<void>(), calls: string[] = [];
  mockFetch(t, async url => {
    const id = String(url).split("/").at(-1)!; calls.push(id);
    if (id === "a") { entered.resolve(); return reply.promise; }
    return new Response(body(id));
  });
  const old = f.s.interest(interest(1, [ref("a"), ref("unused")]));
  await entered.promise;
  const next = f.s.interest(interest(2, [ref("b")]));
  assert.equal(f.s.reservedBytes, 2000); // active a + queued b; unused released
  assert.deepEqual(calls, ["a"]);
  reply.resolve(new Response(body("a")));
  await Promise.all([old, next]);
  assert.deepEqual(calls, ["a", "b"]);
  assert.deepEqual(f.mounted, ["b:1"]);
  assert.deepEqual(f.emitted, [{type: "world_loaded", payload: {revision: 2, chunkIds: ["b"]}}]);
});

test("clear aborts an active body read but holds reserve until it settles", async t => {
  const f = fixture(), entered = deferred<void>();
  let controller!: ReadableStreamDefaultController<Uint8Array>, signal!: AbortSignal;
  mockFetch(t, async (_url, options) => {
    signal = options!.signal!;
    return new Response(new ReadableStream<Uint8Array>({start(c) { controller = c; }, pull() { entered.resolve(); }}));
  });
  const loading = f.s.interest(interest(1, [ref("a")]));
  await entered.promise;
  f.s.clear();
  assert.equal(signal.aborted, true);
  assert.equal(f.s.reservedBytes, 1000);
  controller.close();
  await loading;
  assert.equal(f.s.reservedBytes, 0);
  assert.equal(f.s.budget.bytes, 100);
  assert.deepEqual(f.mounted, []);
  assert.deepEqual(f.emitted, []);
});

test("chunk version changes evict old data and mismatched replies cannot mount", async t => {
  const f = fixture();
  mockFetch(t, async () => new Response(body("a", 1000, 1)));
  await f.s.interest(interest(1, [ref("a")]));
  await f.s.interest(interest(2, [ref("a", 1000, 2)]));
  assert.deepEqual(f.disposed, ["a"]);
  assert.deepEqual(f.mounted, ["a:1"]);
  assert.equal(f.s.count, 0);
  assert.equal(f.s.budget.bytes, 100 + jsonBytes(interest(2, [ref("a", 1000, 2)])));
  failed(f, "INVALID_DATA", 2, "a");
});

test("world version mismatch aborts old work and explicitly requires reconstruction", async t => {
  const f = fixture(), reply = deferred<Response>(), entered = deferred<void>();
  let signal!: AbortSignal;
  mockFetch(t, async (_url, options) => { signal = options!.signal!; entered.resolve(); return reply.promise; });
  const old = f.s.interest(interest(1, [ref("a")]));
  await entered.promise;
  await f.s.interest(interest(2, [ref("b")], {worldVersion: "new-world"}));
  assert.equal(signal.aborted, true);
  failed(f, "INVALID_DATA", 2, null);
  assert.match(f.reports.at(-1)!, /version|верси/i);
  reply.resolve(new Response(body("a")));
  await old;
  assert.deepEqual(f.mounted, []);
});

test("bounded stream rejects overflow, cancels it, and never calls response.json", async t => {
  const f = fixture(); let cancelled = false;
  mockFetch(t, async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new Uint8Array(1001)); }, cancel() { cancelled = true; },
    }));
    response.json = async () => { throw new Error("unlimited JSON read"); };
    return response;
  });
  await f.s.interest(interest(1, [ref("a")]));
  assert.equal(cancelled, true);
  assert.deepEqual(f.mounted, []);
  assert.equal(f.s.reservedBytes, 0);
  failed(f, "BUDGET", 1, "a");
});

test("decodes split UTF-8 within declared byte length without response.json", async t => {
  const f = fixture(), bytes = new TextEncoder().encode(JSON.stringify({...chunk("a"), label: "Дорога 🚌"}));
  mockFetch(t, async () => {
    let offset = 0;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(c) { if (offset < bytes.length) c.enqueue(bytes.slice(offset, ++offset)); else c.close(); },
    }));
    response.json = async () => { throw new Error("unlimited JSON read"); };
    return response;
  });
  await f.s.interest(interest(1, [ref("a", bytes.length)]));
  assert.deepEqual(f.mounted, ["a:1"]);
  assert.equal(f.s.budget.bytes, 100 + bytes.length + jsonBytes(interest(1, [ref("a", bytes.length)])));
});

test("unsupported declared resources fail before any fetch", async t => {
  const f = fixture(); let calls = 0;
  mockFetch(t, async () => { calls++; return new Response(body("a")); });
  await f.s.interest(interest(1, [{...ref("a"), resources: [{id: "texture", version: "1", byteLength: 10}]}]));
  assert.equal(calls, 0);
  failed(f, "INVALID_DATA", 1, "a");
  assert.match(f.reports.at(-1)!, /ресурс|resource/i);
});

test("HTTP, malformed JSON, resources, wrong identity/schema/length emit explicit codes", async t => {
  const cases = [
    {response: () => new Response("no", {status: 503}), code: "FETCH"},
    {response: () => new Response("{".padEnd(1000)), code: "INVALID_DATA"},
    {response: () => new Response(JSON.stringify({...chunk("a"), resources: ["texture"]}).padEnd(1000)), code: "INVALID_DATA"},
    {response: () => new Response(body("other")), code: "INVALID_DATA"},
    {response: () => new Response(JSON.stringify({...chunk("a"), objects: null}).padEnd(1000)), code: "INVALID_DATA"},
    {response: () => new Response(body("a", 500)), code: "INVALID_DATA"},
  ];
  for (const c of cases) {
    mockFetch(t, async () => c.response());
    const f = fixture();
    await f.s.interest(interest(1, [ref("a")]));
    assert.deepEqual(f.mounted, []);
    assert.equal(f.s.reservedBytes, 0);
    assert.equal(f.s.budget.bytes, 100 + jsonBytes(interest(1, [ref("a")])));
    failed(f, c.code, 1, "a");
    t.mock.restoreAll();
  }
});

test("fetch failure releases queued reservations without acknowledging partial installation", async t => {
  const f = fixture();
  mockFetch(t, async url => {
    if (String(url).endsWith("/b")) throw new Error("network offline");
    return new Response(body("a"));
  });
  await f.s.interest(interest(1, [ref("a"), ref("b"), ref("c")]));
  assert.deepEqual(f.mounted, ["a:1"]);
  assert.equal(f.s.budget.bytes, 1100 + jsonBytes(interest(1, [ref("a"), ref("b"), ref("c")])));
  assert.equal(f.s.reservedBytes, 0);
  failed(f, "FETCH", 1, "b");
  assert.equal(f.emitted.length, 1);
});

test("default metadata uses UTF-8 JSON bytes; an interest cap cannot omit metadata", async t => {
  const s = new Streamer(meta, () => {}, () => {}, () => {});
  assert.equal(s.budget.bytes, new TextEncoder().encode(JSON.stringify(meta)).length);
  const f = fixture(); let calls = 0;
  mockFetch(t, async () => { calls++; return new Response(body("a")); });
  await f.s.interest(interest(1, [ref("a")], {cacheBudgetBytes: 1050}));
  assert.equal(calls, 0);
  failed(f, "BUDGET", 1, null);
});

test("invalid UTF-8 cancels an unfinished body before releasing its reservation", async t => {
  const f = fixture();
  const cancelStarted = deferred<void>(), finishCancel = deferred<void>();
  mockFetch(t, async () => new Response(new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new Uint8Array([0xff])); },
    cancel() { cancelStarted.resolve(); return finishCancel.promise; },
  })));
  const loading = f.s.interest(interest(1, [ref("a")]));
  // A missing cancellation must fail instead of hanging this regression test.
  await Promise.race([
    cancelStarted.promise,
    loading.then(() => { throw new Error("invalid body was released without cancellation"); }),
  ]);
  assert.equal(f.s.reservedBytes, 1000);
  finishCancel.resolve();
  await loading;
  assert.equal(f.s.reservedBytes, 0);
  failed(f, "INVALID_DATA", 1, "a");
});

test("retained bytes participate in whole-batch admission, then removed IDs free them", async t => {
  const f = fixture(), calls: string[] = [];
  mockFetch(t, async url => {
    const id = String(url).split("/").at(-1)!; calls.push(id);
    return new Response(body(id, 4000));
  });
  await f.s.interest(interest(1, [ref("a", 4000)]));
  await f.s.interest(interest(2, [ref("a", 4000), ref("b", 4000)]));
  failed(f, "BUDGET", 2, null);
  assert.deepEqual(calls, ["a"]);
  assert.equal(f.s.budget.bytes, 4100 + jsonBytes(interest(2, [ref("a", 4000), ref("b", 4000)])));
  await f.s.interest(interest(3, [ref("b", 4000)], {removeChunkIds: ["a"]}));
  assert.deepEqual(calls, ["a", "b"]);
  assert.deepEqual(f.disposed, ["a"]);
  assert.equal(f.s.budget.bytes, 4100 + jsonBytes(interest(3, [ref("b", 4000)], {removeChunkIds: ["a"]})));
});

test("copies the accepted interest snapshot before awaiting the response", async t => {
  const f = fixture(), reply = deferred<Response>(), entered = deferred<void>();
  const message = interest(1, [ref("a")]);
  const metadataSize = jsonBytes(message);
  mockFetch(t, async () => { entered.resolve(); return reply.promise; });
  const loading = f.s.interest(message);
  await entered.promise;
  message.revision = 999;
  message.chunks[0].version = 99;
  message.chunks[0].dataBytes = 1;
  message.chunks.push(ref("injected"));
  reply.resolve(new Response(body("a")));
  await loading;
  assert.deepEqual(f.mounted, ["a:1"]);
  assert.equal(f.s.budget.bytes, 1100 + metadataSize);
  assert.equal(f.s.reservedBytes, 0);
  assert.deepEqual(f.emitted, [{type: "world_loaded", payload: {revision: 1, chunkIds: ["a"]}}]);
});

test("duplicates count once; conflicting declarations and missing sizes fail before fetch", async t => {
  const f = fixture(); let calls = 0;
  mockFetch(t, async () => { calls++; return new Response(body("a")); });
  await f.s.interest(interest(0, [ref("a"), ref("a")]));
  assert.equal(calls, 1);
  assert.equal(f.s.budget.bytes, 1100 + jsonBytes(interest(0, [ref("a"), ref("a")])));
  assert.deepEqual(f.emitted[0], {type: "world_loaded", payload: {revision: 0, chunkIds: ["a"]}});
  await f.s.interest(interest(1, [ref("b"), ref("b", 1000, 2)]));
  failed(f, "INVALID_DATA", 1, "b");
  await f.s.interest(interest(2, [{...ref("b"), dataBytes: undefined as unknown as number}]));
  failed(f, "INVALID_DATA", 2, "b");
  assert.equal(calls, 1);
});

test("a stale active body cannot mount an older version under a newer revision", async t => {
  const f = fixture(), entered = deferred<void>();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let calls = 0;
  mockFetch(t, async () => {
    calls++;
    if (calls === 2) return new Response(body("a", 1000, 2));
    return new Response(new ReadableStream<Uint8Array>({start(c) {controller = c;}, pull() {entered.resolve();}}));
  });
  const old = f.s.interest(interest(1, [ref("a")]));
  await entered.promise;
  const next = f.s.interest(interest(2, [ref("a", 1000, 2)]));
  assert.equal(f.s.reservedBytes, 2000);
  controller.enqueue(new TextEncoder().encode(body("a")));
  await Promise.all([old, next]);
  assert.deepEqual(f.mounted, ["a:2"]);
  assert.equal(f.s.budget.bytes, 1100 + jsonBytes(interest(2, [ref("a", 1000, 2)])));
  assert.equal(f.s.reservedBytes, 0);
  assert.deepEqual(f.emitted, [{type: "world_loaded", payload: {revision: 2, chunkIds: ["a"]}}]);
});

test("mount failure removes retained accounting and releases the remaining batch", async t => {
  const emitted: {type: string; payload: any}[] = [], disposed: string[] = [], reports: string[] = [];
  const s = new Streamer(meta, () => { throw new Error("renderer rejected chunk"); },
    id => disposed.push(id), m => reports.push(m), (type, payload) => emitted.push({type, payload}), 100);
  let calls = 0;
  mockFetch(t, async () => { calls++; return new Response(body("a")); });
  await s.interest(interest(1, [ref("a"), ref("b")]));
  assert.equal(calls, 1);
  assert.equal(s.count, 0);
  assert.equal(s.budget.bytes, 100 + jsonBytes(interest(1, [ref("a"), ref("b")])));
  assert.equal(s.reservedBytes, 0);
  assert.deepEqual(disposed, ["a"]);
  assert.equal(emitted[0].type, "world_load_failed");
  assert.equal(emitted[0].payload.code, "INVALID_DATA");
  assert.ok(reports[0]);
});

test("current interest payload is retained once after install and clear releases it", async t => {
  const f = fixture(), message = interest(1, [ref("a")]);
  const payloadBytes = new TextEncoder().encode(JSON.stringify(message)).byteLength;
  mockFetch(t, async () => new Response(body("a")));
  await f.s.interest(message);
  assert.equal(f.s.budget.bytes, 1100 + payloadBytes);
  await f.s.interest(interest(2, [ref("a")]));
  assert.equal(f.s.budget.bytes, 1100 + payloadBytes);
  f.s.clear();
  assert.equal(f.s.budget.bytes, 100);
});

test("measured interest bytes include raw whitespace and affect admission before fetch", async t => {
  const f = fixture(); let calls = 0;
  mockFetch(t, async () => { calls++; return new Response(body("a", 7000)); });
  await f.s.interest(interest(1, [ref("a", 7000)]), 901);
  assert.equal(calls, 0); // 100 metadata + 901 interest + 7000 data > 8000
  assert.equal(f.s.reservedBytes, 0);
  assert.equal(f.s.budget.bytes, 1001);
  failed(f, "BUDGET", 1, null);
});

test("serialized interest alone can exceed a cap that previously admitted its chunk", async t => {
  const f = fixture(); let calls = 0;
  mockFetch(t, async () => { calls++; return new Response(body("a", 7700)); });
  const message = interest(1, [ref("a", 7700)], {removeChunkIds: ["x".repeat(300)]});
  const payloadBytes = new TextEncoder().encode(JSON.stringify(message)).byteLength;
  assert.ok(payloadBytes > 200);
  await f.s.interest(message);
  assert.equal(calls, 0);
  assert.equal(f.s.budget.bytes, 100 + payloadBytes);
  failed(f, "BUDGET", 1, null);
});

test("stale wanted descriptors stay charged until settlement, sharing current refs once", async t => {
  const f = fixture(), entered = deferred<void>(), reply = deferred<Response>();
  const oldMessage = interest(1, [ref("a"), ref("shared")]);
  const nextMessage = interest(2, [ref("shared"), ref("b")]);
  const oldBytes = new TextEncoder().encode(JSON.stringify(oldMessage)).byteLength;
  const nextBytes = new TextEncoder().encode(JSON.stringify(nextMessage)).byteLength;
  const aBytes = new TextEncoder().encode(JSON.stringify(ref("a"))).byteLength;
  const calls: string[] = [];
  mockFetch(t, async url => {
    const id = String(url).split("/").at(-1)!; calls.push(id);
    if (id === "a") { entered.resolve(); return reply.promise; }
    return new Response(body(id));
  });
  const old = f.s.interest(oldMessage);
  await entered.promise;
  assert.equal(f.s.budget.bytes, 100 + oldBytes);
  const next = f.s.interest(nextMessage);
  assert.equal(f.s.budget.bytes, 100 + nextBytes + aBytes);
  assert.equal(f.s.reservedBytes, 3000);
  reply.resolve(new Response(body("a")));
  await Promise.all([old, next]);
  assert.equal(f.s.budget.bytes, 2100 + nextBytes);
  assert.equal(f.s.reservedBytes, 0);
  assert.deepEqual(calls, ["a", "shared", "b"]);
});

test("clear keeps all stale wanted descriptors until an active read settles", async t => {
  const f = fixture(), entered = deferred<void>();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const aBytes = new TextEncoder().encode(JSON.stringify(ref("a"))).byteLength;
  const bBytes = new TextEncoder().encode(JSON.stringify(ref("b"))).byteLength;
  mockFetch(t, async () => new Response(new ReadableStream<Uint8Array>({
    start(c) {controller = c;}, pull() {entered.resolve();},
  })));
  const loading = f.s.interest(interest(1, [ref("a"), ref("b")]));
  await entered.promise;
  f.s.clear();
  assert.equal(f.s.budget.bytes, 100 + aBytes + bBytes);
  assert.equal(f.s.reservedBytes, 1000);
  controller.close();
  await loading;
  assert.equal(f.s.budget.bytes, 100);
  assert.equal(f.s.reservedBytes, 0);
});

test("metadata from an unsettled stale load prevents optimistic batch admission", async t => {
  const f = fixture(), entered = deferred<void>(), reply = deferred<Response>();
  let calls = 0;
  mockFetch(t, async () => {
    calls++;
    if (calls > 1) return new Response(body("b", 4600));
    entered.resolve();
    return reply.promise;
  });
  const old = f.s.interest(interest(1, [ref("a", 3000), ref("old-only")]));
  await entered.promise;
  // 100 meta + 3000 old reserve + 300 current payload + 4600 new data = 8000,
  // but the old wanted descriptors are still held in addition to that.
  const next = f.s.interest(interest(2, [ref("b", 4600)]), 300);
  t.after(async () => {
    reply.resolve(new Response(body("a", 3000)));
    await Promise.all([old, next]);
  });
  assert.equal(calls, 1);
  failed(f, "BUDGET", 2, null);
  reply.resolve(new Response(body("a", 3000)));
  await Promise.all([old, next]);
  assert.equal(f.s.budget.bytes, 400);
});

test("a different version of the same ID is a distinct held descriptor until settlement", async t => {
  const f = fixture(), entered = deferred<void>(), reply = deferred<Response>();
  let calls = 0;
  mockFetch(t, async () => {
    if (++calls > 1) return new Response(body("a", 1000, 2));
    entered.resolve(); return reply.promise;
  });
  const old = f.s.interest(interest(1, [ref("a")]));
  await entered.promise;
  const nextMessage = interest(2, [ref("a", 1000, 2)]);
  const next = f.s.interest(nextMessage);
  assert.equal(f.s.budget.bytes, 100 + jsonBytes(nextMessage) + jsonBytes(ref("a")));
  reply.resolve(new Response(body("a")));
  await Promise.all([old, next]);
  assert.equal(f.s.budget.bytes, 1100 + jsonBytes(nextMessage));
  assert.deepEqual(f.mounted, ["a:2"]);
});

test("UTF-8 interest metadata and measured byte validation cannot undercount JSON", async t => {
  const f = fixture(), id = "Дорога 🚌";
  const message = interest(1, [ref(id)]);
  mockFetch(t, async url => {
    assert.equal(String(url), `/api/v1/world/chunks/${encodeURIComponent(id)}`);
    return new Response(body(id));
  });
  // Deliberately too-small measurement must not bypass serialized UTF-8 size.
  await f.s.interest(message, 1);
  assert.equal(f.s.budget.bytes, 1100 + jsonBytes(message));
  assert.ok(jsonBytes(message) > JSON.stringify(message).length);
  for (const [index, invalid] of [-1, 0, 1.5, Infinity, NaN].entries()) {
    await f.s.interest(interest(index + 2, []), invalid);
    failed(f, "INVALID_DATA", index + 2, null);
    // An invalid new payload is discarded, but loaded descriptors remain held.
    assert.equal(f.s.budget.bytes, 1100 + jsonBytes(ref(id)));
  }
  f.s.clear();
  assert.equal(f.s.budget.bytes, 100);
});

test("a descriptor payload that cannot itself fit is rejected and discarded", async t => {
  const f = fixture(); let calls = 0;
  mockFetch(t, async () => { calls++; return new Response(body("a")); });
  await f.s.interest(interest(1, [ref("a")], {removeChunkIds: ["x".repeat(8000)]}));
  failed(f, "BUDGET", 1, null);
  assert.equal(calls, 0);
  assert.equal(f.s.budget.bytes, 100);
  assert.equal(f.s.reservedBytes, 0);
});

test("whenIdle waits after clear until active reservations and descriptors are released", async t => {
  const f = fixture(), entered = deferred<void>(), reply = deferred<Response>();
  mockFetch(t, async () => { entered.resolve(); return reply.promise; });
  const loading = f.s.interest(interest(1, [ref("a")]));
  await entered.promise;
  t.after(async () => { reply.resolve(new Response(body("a"))); await loading; });
  f.s.clear();
  let idle = false;
  const settled = f.s.whenIdle().then(() => { idle = true; });
  await Promise.resolve();
  assert.equal(idle, false);
  assert.equal(f.s.reservedBytes, 1000);
  assert.equal(f.s.budget.bytes, 100 + jsonBytes(ref("a")));
  reply.resolve(new Response(body("a")));
  await settled;
  assert.equal(idle, true);
  assert.equal(f.s.reservedBytes, 0);
  assert.equal(f.s.budget.bytes, 100);
  assert.deepEqual(f.mounted, []);
});
