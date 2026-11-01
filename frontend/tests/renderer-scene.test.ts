import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { GameScene } from "../src/game/rendering/scene.ts";
import * as R from "../src/game/rendering/renderer.ts";
const { HintLayer } = R;
import type {Player, Vehicle} from "../src/game/entities/types.ts";
import type {Chunk} from "../src/game/world/types.ts";

// Exercise real snapshot/render/chunk methods without creating a WebGL context.
// Only the final GPU submission is replaced; all geometry and transforms are real.
function sceneFixture() {
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(72, 1, 0.05, 180);
  scene.add(camera);
  const cockpit = new T.Group();
  camera.add(cockpit);
  return Object.assign(Object.create(GameScene.prototype) as GameScene, {
    scene, camera, cockpit, renderer: { render() {} },
    chunks: new Map(), cars: new Map(), pedestrians: new Map(), observers:new Map(), observerYaws:new Map(), signals: new Map(), signalStates: new Map(),
    hints: new HintLayer(scene), targets: [], players: [], selfId: "self", lookYaw: 1.8, lookPitch: 0.8,
  });
}
const player: Player = { id: "self", username: "Self", position: { x: 0, y: 0, z: 0 }, yaw: 0, mode: "driving", vehicleId: "car" };
const car: Vehicle = { id: "car", driverId: null, variant: "blue", position: { x: 10, y: 0, z: 12 }, yaw: Math.PI / 2, speed: 0 };
const bus: Vehicle = { ...car, id: "bus", variant: "bus", position: { x: 0, y: 0, z: -5 }, yaw: 0, speed: 12 };
const chunk: Chunk = { id: "test", version: 1, origin: { x: -16, z: -16 }, size: 32, accountedBytes: 0, resources: [], roads: [], objects: [], agents: [
  { id: "priority", kind: "priority", position: { x: 3, y: 0, z: -2 }, yaw: Math.PI / 2, mainRoadArms: ["north", "west"] },
], teaching: { paths: [], zones: [], signals: [{ id: "light", position: { x: 2, y: 0, z: -5 }, yaw: 0 }] } };

test('stationary observer displays server direction without moving or creating duplicate people',()=>{
 const game=sceneFixture();
 const data:Chunk={...chunk,objects:[{id:'observer',kind:'observer',position:{x:8,y:0,z:8},yaw:0,size:{x:.7,y:1.8,z:.5},color:'#477bac',collidable:false}]};
 game.addChunk(data);
 const person=game.chunks.get(data.id)!.group.children.find(o=>o.userData.objectId==='observer')!;
 let meshes=0;person.traverse(o=>{if(o instanceof T.Mesh)meshes++;});
 assert.ok(meshes<=6,'body and separately rotating face should use at most six draw calls');
 const head=person.getObjectByName('observer-head');assert.ok(head,'observer needs a separate head pivot');
 const faceMeshes=head.children.filter(o=>o instanceof T.Mesh) as T.Mesh<T.BufferGeometry,T.MeshStandardMaterial>[];
 assert.ok(faceMeshes.some(o=>o.material.color.getHex()===0xffffff),'eyes need visible whites');
 assert.ok(faceMeshes.some(o=>o.material.color.getHex()===0x263541),'eyes need dark pupils');
 game.snapshot([],[],[],[],[{id:'observer',yaw:Math.PI/2}]);
 game.render(.1);
 assert.equal(person.rotation.y,0,'body must stay still');
 assert.ok(head.rotation.y>0&&head.rotation.y<Math.PI/2,'head turn should be interpolated');
 for(let i=0;i<40;i++)game.render(.1);
 assert.ok(Math.abs(head.rotation.y-75*Math.PI/180)<.001,'head must respect a natural turn limit');
 assert.equal(person.rotation.y,0);
 assert.deepEqual(person.position.toArray(),[8,0,8]);
 game.snapshot([],[],[],[],[{id:'observer',yaw:-Math.PI/2}]);
 assert.equal(game.chunks.get(data.id)!.group.children.filter(o=>o.userData.objectId==='observer').length,1);
 game.removeChunk(data.id);
 assert.equal(game.chunks.size,0);
});

test("camera stays in its car and ignores compatibility look fields", () => {
  const game = sceneFixture();
  game.snapshot([player], [car]);
  game.render(0);
  assert.ok(Math.abs(game.camera.rotation.y - Math.PI / 2) < 1e-8);
  assert.equal(game.camera.rotation.x, 0);
  assert.ok(game.camera.position.distanceTo(new T.Vector3(10.25, 1.5, 12.3)) < 1e-8);
  assert.equal(game.lookYaw, 1.8);
  assert.equal(game.lookPitch, 0.8);
});

test("bus remains stationary between snapshots and disappears with disposed geometry", () => {
  const game = sceneFixture();
  game.snapshot([], [bus]);
  const model = game.scene.children.find(o => o.userData.objectId === "bus")!;
  let disposed = 0;
  model.traverse(o => { if (o instanceof T.Mesh) o.geometry.addEventListener("dispose", () => disposed++); });
  game.render(10);
  assert.deepEqual(model.position.toArray(), [0, 0, -5]);
  assert.equal(model.rotation.y, 0);
  game.snapshot([], []);
  assert.equal(model.parent, null);
  assert.ok(disposed > 0);
});

test("snapshot renders server pedestrians and signals and clears absent state", () => {
  const game = sceneFixture();
  game.snapshot([], [], [{ id: "walker", position: { x: 1, y: 0, z: -3 }, yaw: 0.5, moving: true }], [{ id: "light", aspect: "green" }]);
  game.addChunk(chunk);
  const walker = game.scene.children.find(o => o.userData.objectId === "walker")!;
  assert.deepEqual(walker.position.toArray(), [1, 0, -3]);
  assert.equal(walker.rotation.y, 0.5);
  const signals: T.Object3D[] = [];
  game.scene.traverse(o => { if (o.userData.objectId === "light") signals.push(o); });
  const green = signals[0].getObjectByName("green") as T.Mesh<T.CircleGeometry, T.MeshBasicMaterial>;
  assert.equal(green.material.color.getHex(), 0x58e68c);
  let disposed = false;
  (walker.children[0] as T.Mesh).geometry.addEventListener("dispose", () => { disposed = true; });
  game.snapshot([], []);
  assert.equal(walker.parent, null);
  assert.equal(disposed, true);
  assert.equal(green.material.color.getHex(), 0x343a3b);
  game.removeChunk(chunk.id);
  assert.equal(signals[0].parent?.parent, null);
  assert.equal(game.chunks.size, 0);
});

test("removing a chunk releases teaching hints and replacing it does not duplicate signs", () => {
  const game = sceneFixture();
  game.addChunk(chunk);
  game.applyHints([{ kind: "highlight", objectIds: ["priority"], pathIds: [], zoneIds: [], durationMs: 5000 }]);
  game.addChunk(chunk);
  const agents: T.Object3D[] = [];
  game.scene.traverse(o => { if (o.userData.agent) agents.push(o); });
  assert.equal(agents.length, 1);
  game.removeChunk(chunk.id);
  assert.equal(game.chunks.size, 0);
  game.clearHints();
});

test("the backend bus object renders as a vehicle, can be picked and highlighted, and owns no student label", () => {
  const game = sceneFixture();
  const data: Chunk = { ...chunk, agents: [], teaching: undefined, objects: [{
    id: "teaching-bus", kind: "bus", position: { x: 14, y: 0, z: 34.5 }, yaw: -Math.PI / 2,
    size: { x: 2.5, y: 3, z: 8.5 }, color: "#f1c45b", collidable: true,
  }] };
  game.addChunk(data);
  const model = game.chunks.get(data.id)!.group.children.find(o => o.userData.objectId === "teaching-bus")!;
  assert.deepEqual(model.position.toArray(), [14, 0, 34.5]);
  assert.equal(model.rotation.y, -Math.PI / 2);
  const wheels: T.Mesh[] = [];
  model.traverse(o => { if (o instanceof T.Mesh && o.geometry instanceof T.CylinderGeometry) wheels.push(o); });
  assert.equal(wheels.length, 4, "a bus must have wheels rather than building windows and a terracotta roof");
  assert.equal(model.getObjectByName("driver-label"), undefined);
  game.camera.position.set(14, 1.5, 38.5);
  game.camera.lookAt(14, 1.5, 34.5);
  assert.equal(R.pickObjectId(game.scene, game.camera), "teaching-bus");
  game.applyHints([{ kind: "highlight", objectIds: ["teaching-bus"], pathIds: [], zoneIds: [], durationMs: 5000 }]);
  const overlay = game.scene.children.find(o => o.userData.pickIgnore)!;
  assert.equal(overlay.children.length, 1);
  const highlight = overlay.children[0] as T.Box3Helper;
  assert.ok(highlight.box.containsPoint(new T.Vector3(17, 2, 34.5)));
  game.snapshot([], []);
  game.render(5);
  assert.deepEqual(model.position.toArray(), [14, 0, 34.5]);
  game.removeChunk(data.id);
  assert.equal(overlay.children.length, 0);
});

function crossedChunk(dx = 0, dz = 0): Chunk {
  return { ...chunk, id: `cross-${dx}-${dz}`, origin: { x: dx, z: dz }, size: 64, agents: [], objects: [], teaching: undefined,
    roads: [
      { id: "ns", position: { x: 32 + dx, y: 0, z: 32 + dz }, yaw: 0, width: 12, length: 64 },
      { id: "ew", position: { x: 32 + dx, y: 0, z: 32 + dz }, yaw: Math.PI / 2, width: 12, length: 64 },
    ],
  };
}

// Inspect actual ray-visible mesh coverage instead of counting named decorations.
function groundHits(root: T.Object3D, x: number, z: number) {
  root.updateMatrixWorld(true);
  return new T.Raycaster(new T.Vector3(x, 10, z), new T.Vector3(0, -1, 0)).intersectObject(root, true);
}
function meshes(root: T.Object3D) {
  const result: T.Mesh[] = [];
  root.traverse(o => { if (o instanceof T.Mesh) result.push(o); });
  return result;
}

test("crossed local roads leave all four junction mouths free of sidewalks and center dashes at real world offsets", () => {
  for (const [dx, dz] of [[0, 0], [64, 0], [0, -64]]) {
    const game = sceneFixture();
    const data = crossedChunk(dx, dz);
    game.addChunk(data);
    const root = game.chunks.get(data.id)!.group;
    for (const [x, z] of [[25.3, 32], [38.7, 32], [32, 25.3], [32, 38.7], [32, 32], [33, 32]]) {
      const hit = groundHits(root, x + dx, z + dz)[0];
      const inside = x >= 26 && x <= 38 && z >= 26 && z <= 38;
      assert.ok(hit && hit.point.y < (inside ? 0.055 : 0.1), `junction asphalt must be exposed at ${x + dx},${z + dz}`);
    }
    assert.ok(groundHits(root, 38.7 + dx, 12 + dz)[0].point.y > 0.15, "sidewalk remains outside the junction");
    const paint = meshes(root).filter(m => {
      const material = m.material as T.MeshStandardMaterial;
      return material.color.getHex() === 0xfff7d5;
    });
    assert.ok(paint.length > 0, "center dashes remain on the approaches");
    for (const dash of paint) {
      // A paint mesh may batch disconnected dashes. Check each actual triangle,
      // rather than its combined bounding box spanning both sides of the junction.
      const geometry=dash.geometry,position=geometry.getAttribute('position'),index=geometry.getIndex();
      for(let i=0;i<(index?.count??position.count);i+=3){
        const points=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(position,index?index.getX(i+j):i+j).applyMatrix4(dash.matrixWorld));
        const b=new T.Box3().setFromPoints(points);
        assert.ok(b.max.x <= 26 + dx + 1e-6 || b.min.x >= 38 + dx - 1e-6 ||
          b.max.z <= 26 + dz + 1e-6 || b.min.z >= 38 + dz - 1e-6, "no fragment of a dash enters the junction");
      }
    }
    game.removeChunk(data.id);
  }
});

test("an isolated road keeps its sidewalks and centerline without inventing a junction", () => {
  const game = sceneFixture();
  const data = crossedChunk();
  data.roads.pop();
  game.addChunk(data);
  const root = game.chunks.get(data.id)!.group;
  assert.ok(groundHits(root, 38.7, 32)[0].point.y > 0.15);
  assert.ok(groundHits(root, 32, 32)[0].point.y > 0.055);
  game.removeChunk(data.id);
});

test("zebra paint follows only supplied crosswalk polygons, in either road direction", () => {
  for (const [id, outline, center, outside] of [
    ["east-walk", [[41, 26], [44, 26], [44, 38], [41, 38]], [42.5, 32.6], [45, 32.6]],
    ["south-walk", [[26, 41], [38, 41], [38, 44], [26, 44]], [32.6, 42.5], [32.6, 45]],
  ] as const) {
    const game = sceneFixture();
    const data = crossedChunk();
    data.teaching = { paths: [], signals: [], zones: [
      { id, kind: "crosswalk", outline: outline.map(([x, z]) => ({ x, y: 0, z })) },
      { id: "stop-zone", kind: "stop", outline: [{ x: 29, y: 0, z: 50 }, { x: 35, y: 0, z: 50 }, { x: 35, y: 0, z: 53 }] },
    ] };
    game.addChunk(data);
    const root = game.chunks.get(data.id)!.group;
    root.updateMatrixWorld(true);
    const zebra = root.children.find(o => o.userData.objectId === id);
    assert.ok(zebra, "crosswalk zone must produce visible stripes");
    const stripes = meshes(zebra);
    assert.ok(stripes.length > 0);
    for (const stripe of stripes) {
      const bounds = new T.Box3().setFromObject(stripe);
      assert.ok(bounds.min.x >= Math.min(...outline.map(p => p[0])) - 1e-6);
      assert.ok(bounds.max.x <= Math.max(...outline.map(p => p[0])) + 1e-6);
      assert.ok(bounds.min.z >= Math.min(...outline.map(p => p[1])) - 1e-6);
      assert.ok(bounds.max.z <= Math.max(...outline.map(p => p[1])) + 1e-6);
    }
    assert.ok(groundHits(zebra, ...center).length > 0, "zebra spans the crosswalk");
    assert.equal(groundHits(zebra, ...outside).length, 0);
    assert.equal(root.children.find(o => o.userData.objectId === "stop-zone"), undefined, "a teaching stop zone is not a legal stop line");
    game.removeChunk(data.id);
  }
});

test("optional teaching markers are small readable labels over round ground discs and release every resource on replacement", () => {
  // Canvas rasterization is browser-owned; retain real CanvasTexture, Sprite,
  // geometry, materials and the complete chunk/hint/disposal lifecycle in Node.
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement: () => ({ width: 0, height: 0, getContext: () => ({
      clearRect() {}, beginPath() {}, roundRect() {}, fill() {}, stroke() {}, fillText() {},
    }) }),
  } });
  try {
    const game = sceneFixture();
    const data = crossedChunk(0, -64);
    data.teaching = { paths: [], zones: [], signals: [], markers: [
      { id: "stop-a", label: "А", position: { x: 34.5, y: 0, z: -11 } },
      { id: "stop-b", label: "Б", position: { x: 34.5, y: 0, z: -18 } },
      { id: "stop-v", label: "В", position: { x: 34.5, y: 0, z: -24 } },
    ] };
    data.objects = [
      { id: "tree", kind: "tree", position: { x: 12, y: 0, z: -12 }, yaw: 0, size: { x: 2, y: 5, z: 2 }, color: "#79a66f" },
      { id: "bus", kind: "bus", position: { x: 14, y: 0, z: -29.5 }, yaw: -Math.PI / 2, size: { x: 2.5, y: 3, z: 8.5 }, color: "#f1c45b" },
      { id: "house", kind: "building", position: { x: 12, y: 0, z: -52 }, yaw: 0, size: { x: 12, y: 8, z: 12 }, color: "#d9cfbc" },
      { id: "walker", kind: "pedestrian", position: { x: 42, y: 0, z: -32 }, yaw: 0, size: { x: 0.6, y: 1.8, z: 0.6 }, color: "#d98150" },
    ];
    data.teaching.zones.push({ id: "walk", kind: "crosswalk", outline: [
      { x: 41, y: 0, z: -38 }, { x: 44, y: 0, z: -38 }, { x: 44, y: 0, z: -26 }, { x: 41, y: 0, z: -26 },
    ] });
    for (let cycle = 0; cycle < 3; cycle++) {
      game.addChunk(data);
      const root = game.chunks.get(data.id)!.group;
      for (const id of ["stop-a", "stop-b", "stop-v"]) {
        const marker = root.children.find(o => o.userData.objectId === id);
        assert.ok(marker, `${id} must be visible`);
        assert.ok(marker.children.some(o => o instanceof T.Mesh && o.geometry instanceof T.CircleGeometry), "marker has a disc, not a transverse road line");
        const sprite = marker.children.find(o => o instanceof T.Sprite) as T.Sprite;
        assert.ok(sprite && sprite.material.map instanceof T.CanvasTexture);
        assert.ok(sprite.scale.x >= 0.5 && sprite.scale.x <= 1.2);
        assert.ok(sprite.position.y > 0.3 && sprite.position.y < 1.5);
      }
      game.applyHints([{ kind: "highlight", objectIds: ["stop-v"], pathIds: [], zoneIds: [], durationMs: 5000 }]);
      const resources = new Set<T.BufferGeometry | T.Material | T.Texture>();
      game.scene.traverse(o => {
        if (o instanceof T.Mesh || o instanceof T.Sprite || o instanceof T.Line) {
          if (o.geometry) resources.add(o.geometry);
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            resources.add(m);
            for (const value of Object.values(m)) if (value instanceof T.Texture) resources.add(value);
          }
        }
      });
      const counts = new Map([...resources].map(r => [r, 0]));
      for (const resource of resources) resource.addEventListener("dispose", () => counts.set(resource, counts.get(resource)! + 1));
      game.addChunk({ ...data, teaching: undefined });
      assert.ok([...counts.values()].every(n => n === 1), "replacement disposes each old geometry, material and label texture exactly once");
      game.removeChunk(data.id);
      assert.equal(game.chunks.size, 0);
      assert.equal(game.scene.children.length, 2, "only camera and the empty hint layer remain");
    }
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("local tree crowns respect object dimensions and building roofs taper without a mesh per window", () => {
  const game = sceneFixture();
  const data: Chunk = { ...crossedChunk(), objects: [
    { id: "tree", kind: "tree", position: { x: 12, y: 0, z: 20 }, yaw: 0, size: { x: 2.2, y: 5, z: 2.8 }, color: "#79a66f" },
    { id: "house", kind: "building", position: { x: 12, y: 0, z: 12 }, yaw: 0, size: { x: 12, y: 8, z: 12 }, color: "#d9cfbc" },
  ] };
  game.addChunk(data);
  const root = game.chunks.get(data.id)!.group;
  root.updateMatrixWorld(true);
  const tree = root.children.find(o => o.userData.objectId === "tree")!;
  const bounds = new T.Box3().setFromObject(tree);
  const size = bounds.getSize(new T.Vector3());
  assert.ok(size.x <= 2.2 + 1e-6 && size.z <= 2.8 + 1e-6 && size.y <= 5 + 1e-6, "foliage must fit the server object's envelope");
  let triangles = 0;
  for (const mesh of meshes(tree)) triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
  assert.ok(triangles <= 120, "trees stay cheap enough for streamed city blocks");
  const house = root.children.find(o => o.userData.objectId === "house")!;
  const houseMeshes = meshes(house);
  assert.ok(houseMeshes.length <= 5, "batch local windows rather than allocating one geometry/material per window");
  const roof = houseMeshes.find(m => new T.Box3().setFromObject(m).min.y >= 8)!;
  assert.ok(roof, "the building retains a separate warm roof");
  const positions = roof.geometry.attributes.position;
  let topWidth = 0, baseWidth = 0;
  for (let i = 0; i < positions.count; i++) {
    if (positions.getY(i) > 0) topWidth = Math.max(topWidth, Math.abs(positions.getX(i)));
    else baseWidth = Math.max(baseWidth, Math.abs(positions.getX(i)));
  }
  assert.ok(topWidth < baseWidth, "roof has shallow sloped edges instead of a hard rectangular slab");
  game.removeChunk(data.id);
});

test("static backend pedestrians survive empty snapshots and signals fall back only to their explicit initialAspect", () => {
  const game = sceneFixture();
  const initialSignal = { id: "static-light", position: { x: 105, y: 0, z: 26 }, yaw: 0, initialAspect: "green" as const };
  const data: Chunk = { ...crossedChunk(64), objects: [{
    id: "static-walker", kind: "pedestrian", position: { x: 105, y: 0, z: 32 }, yaw: Math.PI / 2,
    size: { x: 0.6, y: 1.8, z: 0.6 }, color: "#d98150", collidable: false,
  }], teaching: { paths: [], zones: [], signals: [initialSignal,
    { id: "unspecified-light", position: { x: 105, y: 0, z: 38 }, yaw: Math.PI },
  ] } };
  game.addChunk(data);
  const root = game.chunks.get(data.id)!.group;
  const walker = root.children.find(o => o.userData.objectId === "static-walker")!;
  assert.ok(meshes(walker).some(m => m.geometry instanceof T.SphereGeometry), "static people use the same head/body geometry as live pedestrians");
  assert.deepEqual(walker.position.toArray(), [105, 0, 32]);
  assert.equal(walker.rotation.y, Math.PI / 2);
  const light = root.children.find(o => o.userData.objectId === "static-light")!;
  const unspecified = root.children.find(o => o.userData.objectId === "unspecified-light")!;
  const color = (group: T.Object3D, aspect: string) => ((group.getObjectByName(aspect) as T.Mesh).material as T.MeshBasicMaterial).color.getHex();
  assert.equal(color(light, "green"), 0x58e68c);
  assert.equal(color(unspecified, "green"), 0x343a3b, "no green is invented when server metadata omits it");
  game.snapshot([], [], [], [{ id: "static-light", aspect: "red" }]);
  assert.equal(color(light, "red"), 0xf2483c);
  assert.equal(color(light, "green"), 0x343a3b);
  game.snapshot([], [], [], []);
  assert.equal(color(light, "green"), 0x58e68c);
  assert.equal(walker.parent, root, "an empty live-pedestrian list does not remove a static world exhibit");
  game.removeChunk(data.id);
});
