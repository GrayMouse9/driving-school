import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Reject missing content before importing the generator: useful on a fresh checkout.
const target = new URL('./training-world.json', import.meta.url);
assert.ok(existsSync(target), 'Generate server-data/world/training-world.json first');
const { buildWorld, readBaseWorld } = await import('./generate-training-world.mjs');
const raw = readFileSync(target, 'utf8');
const world = JSON.parse(raw);
assert.equal(raw, JSON.stringify(buildWorld()) + '\n', 'Generated artifact is stale');
assert.equal(JSON.stringify(buildWorld()), JSON.stringify(buildWorld()), 'Non-deterministic generator');
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const base = readBaseWorld();
const enriched = new Set(['c_0_0']);
assert.equal(world.chunks.length, 100);
assert.deepEqual(Object.keys(world), ['version', 'spawnPoints', 'chunks']);
const ids = new Set();
function unique(id) { assert.ok(id && !ids.has(id), `Duplicate/missing ID: ${id}`); ids.add(id); }
const radius = 2.1; // backend/internal/player/physics.go vehicleRadius
function clearance(p, box) {
  const dx = p.x - box.position.x, dz = p.z - box.position.z;
  const c = Math.cos(box.yaw), s = Math.sin(box.yaw);
  const x = dx * c - dz * s, z = dx * s + dz * c;
  return Math.hypot(Math.max(Math.abs(x) - box.size.x / 2, 0), Math.max(Math.abs(z) - box.size.z / 2, 0));
}
function inChunk(p, c) { return p.x >= c.origin.x && p.x < c.origin.x + c.size && p.z >= c.origin.z && p.z < c.origin.z + c.size; }
function onRoad(p, road, margin = 0) {
  const dx = p.x - road.position.x, dz = p.z - road.position.z;
  const c = Math.cos(road.yaw), s = Math.sin(road.yaw);
  return Math.abs(dx * c - dz * s) <= road.width / 2 - margin + 1e-8 && Math.abs(dx * s + dz * c) <= road.length / 2 + 1e-8;
}
const obstacles = world.chunks.flatMap(c => c.objects.filter(o => o.collidable));
for (const [index, c] of world.chunks.entries()) {
  unique(c.id);
  assert.equal(c.size, 64);
  assert.ok(c.version >= 1);
  for (const name of ['objects', 'roads', 'agents', 'resources']) assert.ok(Array.isArray(c[name]));
  assert.deepEqual(c.resources, []);
  const expectedRoads=base.chunks[index].roads.filter(r=>Math.abs(Math.cos(r.yaw))>0.5?r.position.x===32:r.position.z===32);
  assert.deepEqual(c.roads, expectedRoads, 'Exactly two continuous roads share one junction');
  if (!enriched.has(c.id)) assert.deepEqual(c, {...base.chunks[index],roads:expectedRoads}, 'No padding or invented background chunks');
  for (const prior of world.chunks.slice(0, index)) assert.ok(!(c.origin.x < prior.origin.x + 64 && c.origin.x + 64 > prior.origin.x && c.origin.z < prior.origin.z + 64 && c.origin.z + 64 > prior.origin.z));
  for (const o of c.objects) {
    unique(o.id);
    assert.ok(inChunk(o.position, c));
    assert.ok(['x', 'y', 'z'].every(k => Number.isFinite(o.size[k]) && o.size[k] > 0));
    if (o.kind !== 'bus' && !(c.id === 'c_-1_0' && o.kind === 'pedestrian' && o.collidable === false)) for (const road of c.roads) {
      // Buildings have yaw=0; their entire footprint, not only their centre, stays off asphalt.
      assert.ok(Math.abs(o.position.x - road.position.x) >= o.size.x / 2 + (road.yaw === 0 ? road.width : road.length) / 2 || Math.abs(o.position.z - road.position.z) >= o.size.z / 2 + (road.yaw === 0 ? road.length : road.width) / 2, `${o.id} obstructs a road`);
    }
  }
  for (const road of c.roads) unique(road.id);
  for (const agent of c.agents) {
    unique(agent.id);
    assert.ok(inChunk(agent.position, c));
    assert.ok(!c.roads.some(r => onRoad(agent.position, r)), `${agent.id} on asphalt`);
  }
  if (!c.teaching) continue;
  for (const collection of Object.values(c.teaching)) for (const item of collection) unique(item.id);
  for (const p of c.teaching.paths) {
    assert.ok(p.points.length >= 2);
    for (let i = 1; i < p.points.length; i++) {
      const a = p.points[i - 1], b = p.points[i];
      const steps = Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) / 0.25);
      for (let j = 0; j <= steps; j++) {
        const point = { x: a.x + (b.x - a.x) * j / steps, z: a.z + (b.z - a.z) * j / steps };
        if (p.id.includes('pedestrian')) continue; // Walking paths deliberately include sidewalks.
        assert.ok(world.chunks.some(chunk => chunk.roads.some(r => onRoad(point, r, radius))), `${p.id} leaves its road`);
        for (const box of obstacles) if (box.id !== 'shared-bus' || p.id !== 'shared-bus-straight') assert.ok(clearance(point, box) >= radius, `${p.id} hits ${box.id}`);
      }
    }
  }
  for (const zone of c.teaching.zones) assert.ok(zone.outline.length >= 3 && zone.outline.every(p => inChunk(p, c)));
}
assert.deepEqual(world.spawnPoints, [{x:34.5,y:0,z:50,yaw:0},{x:29.5,y:0,z:14,yaw:Math.PI},{x:42,y:0,z:48,yaw:0}]);
let separation = Infinity, spawnClearance = Infinity;
for (const [i, p] of world.spawnPoints.entries()) {
  assert.equal(world.chunks.filter(c => inChunk(p, c)).length, 1);
  for (const q of world.spawnPoints.slice(0, i)) separation = Math.min(separation, Math.hypot(p.x - q.x, p.z - q.z));
  for (const o of obstacles) spawnClearance = Math.min(spawnClearance, clearance(p, o));
}
assert.ok(separation >= 4.2);
assert.ok(spawnClearance >= radius);
const shared = world.chunks.find(c => c.id === 'c_0_0');
const bus = shared.objects.find(o => o.id === 'shared-bus');
assert.equal(bus.kind, 'bus'); assert.equal(bus.collidable, true);
assert.deepEqual(bus.position, {x:14,y:0,z:34.5});
assert.deepEqual(bus.size, {x:2.5,y:3,z:8.5}); assert.equal(bus.yaw, -Math.PI / 2);
for (const a of shared.agents) assert.deepEqual(a.mainRoadArms, ['south', 'west']);
// Match world.go: raw chunk bytes + internal reference manifest (not world-file bytes).
const refs = world.chunks.map(c => ({id:c.id, version:c.version, dataBytes:bytes(c), resources:[]}));
const total = refs.reduce((n, r) => n + r.dataBytes, 0) + bytes({version:world.version, chunks:refs});
const budget = Math.floor(total * 8 / 100);
const meta = {version:world.version,totalWorldBytes:total,cacheBudgetBytes:budget,accounting:'utf8-uncompressed-json-plus-unique-assets'};
function interest(point, revision, previous) {
  const current = world.chunks.find(c => inChunk(point, c)); assert.ok(current);
  const candidates = world.chunks.map((c, i) => ({c, ref:refs[i]})).sort((a, b) => {
    if (a.c.id === current.id) return -1; if (b.c.id === current.id) return 1;
    const distance = c => Math.hypot(point.x - c.origin.x - 32, point.z - c.origin.z - 32);
    return distance(a.c) - distance(b.c) || (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0);
  });
  const result = {revision,worldVersion:world.version,chunks:[],removeChunkIds:[],cacheBudgetBytes:budget};
  const removed = () => previous.filter(id => !result.chunks.some(c => c.id === id));
  let used = 0;
  for (const {ref} of candidates) {
    result.chunks.push(ref); result.removeChunkIds = removed();
    if (bytes(meta) + bytes(result) + used + ref.dataBytes > budget) {
      result.chunks.pop(); result.removeChunkIds = removed(); break;
    }
    used += ref.dataBytes;
  }
  assert.equal(result.chunks[0]?.id, current.id, `Current chunk does not fit: ${current.id}`);
  const residentBytes = bytes(meta) + bytes(result) + used;
  assert.ok(residentBytes <= budget && residentBytes <= total / 10);
  assert.ok(residentBytes + 1 <= budget, 'HTTP metadata trailing newline must also fit');
  return {ids:result.chunks.map(c => c.id),residentBytes};
}
const samples = [...world.spawnPoints, ...world.chunks.map(c => ({x:c.origin.x+32,z:c.origin.z+32})), ...[-0.01,0,0.01,63.99,64,64.01].map(x => ({x,z:29.5})), {x:-29.5,z:17},{x:87,z:34.5}];
assert.ok(samples.length >= 8);
let previous = [], peak = 0;
const cases = [];
for (const [i, p] of samples.entries()) {
  const result = interest(p, i + 1, previous); previous = result.ids;
  cases.push({point:p,...result});
  peak = Math.max(peak, result.residentBytes);
}
console.log(JSON.stringify({file:fileURLToPath(target),fileBytes:Buffer.byteLength(raw),chunks:world.chunks.length,totalWorldBytes:total,cacheBudgetBytes:budget,budgetSets:samples.length,peakResidentBytes:peak,minSpawnSeparation:separation,minSpawnObstacleDistance:spawnClearance,vehicleRadius:radius,sceneBytes:refs.filter(r=>enriched.has(r.id))}, null, 2));

if (process.argv.includes('--go')) {
  // A Go build overlay adds a temporary test without writing any server file.
  // Exercise the actual unexported loader/interest code; no database is needed.
  const temporary = mkdtempSync(join(tmpdir(), 'training-world-check-'));
  const serverDir = fileURLToPath(new URL('../../backend/', import.meta.url));
  try {
    const fixture = join(temporary, 'fixture.json');
    writeFileSync(fixture, JSON.stringify({worldFile:fileURLToPath(target),total,budget,cases}));
    const testFile = join(temporary, 'content_test.go');
    writeFileSync(testFile, `package world
import ("encoding/json"; "os"; "reflect"; "testing")
func TestTrainingContentWorld(t *testing.T) {
  var fixture struct {
    WorldFile string
    Total, Budget int
    Cases []struct { Point SpawnPoint; IDs []string; ResidentBytes int }
  }
  input, err := os.ReadFile(os.Getenv("CONTENT_CHECK_FIXTURE")); if err != nil { t.Fatal(err) }
  if err := json.Unmarshal(input, &fixture); err != nil { t.Fatal(err) }
  data, err := os.ReadFile(fixture.WorldFile); if err != nil { t.Fatal(err) }
  w, err := Load(data); if err != nil { t.Fatal(err) }
  if len(w.Chunks) != 100 || len(w.Spawns) != 3 { t.Fatal("wrong chunk/spawn count") }
  if w.Meta.TotalWorldBytes != fixture.Total || w.Meta.CacheBudgetBytes != fixture.Budget { t.Fatalf("byte accounting mismatch: %+v", w.Meta) }
  meta, err := json.Marshal(w.Meta); if err != nil { t.Fatal(err) }
  var previous []string
  for i, sample := range fixture.Cases {
    area, err := w.Interest(sample.Point.X, sample.Point.Z, i+1, previous); if err != nil { t.Fatalf("sample %d: %v", i, err) }
    encoded, err := json.Marshal(area); if err != nil { t.Fatal(err) }
    used := len(meta) + len(encoded)
    ids := []string{}
    for _, ref := range area.Chunks { used += len(w.Chunks[ref.ID].Data); ids = append(ids, ref.ID) }
    if !reflect.DeepEqual(ids, sample.IDs) || used != sample.ResidentBytes { t.Fatalf("sample %d mismatch: ids=%v used=%d expected=%v/%d", i, ids, used, sample.IDs, sample.ResidentBytes) }
    if used > w.Meta.CacheBudgetBytes { t.Fatalf("sample %d exceeds budget", i) }
    previous = ids
  }
  t.Logf("real Go loader: %d chunks, %d spawns, total=%d budget=%d, %d interest sets", len(w.Chunks), len(w.Spawns), w.Meta.TotalWorldBytes, w.Meta.CacheBudgetBytes, len(fixture.Cases))
}
`);
    const overlay = join(temporary, 'overlay.json');
    writeFileSync(overlay, JSON.stringify({Replace:{[join(serverDir,'internal/world/zz_content_world_check_test.go')]:testFile}}));
    const result = spawnSync('go', ['test','-overlay',overlay,'-run','^TestTrainingContentWorld$','-count=1','-v','./internal/world'], {
      cwd:serverDir,env:{...process.env,CONTENT_CHECK_FIXTURE:fixture,GOCACHE:process.env.GOCACHE ?? join(tmpdir(),'hahaton-go-cache'),GOMODCACHE:process.env.GOMODCACHE ?? join(tmpdir(),'hahaton-go-mod')},encoding:'utf8',timeout:120000,
    });
    process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
    if (result.error) throw result.error;
    assert.equal(result.status, 0, 'Actual Go loader/accounting check failed');
  } finally { rmSync(temporary, {recursive:true,force:true}); }
}
