import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import * as R from "../src/game/rendering/renderer.ts";
import type {Agent} from "../src/game/entities/types.ts";
import type {Chunk} from "../src/game/world/types.ts";
import type { VisualHint } from "../src/network/protocol.ts";

const agent = { id: "sign", kind: "priority", position: { x: 0, y: 0, z: -3 }, yaw: 0 } as Agent;
const hint: VisualHint = { kind: "highlight", objectIds: ["sign"], pathIds: ["path"], zoneIds: ["zone"], durationMs: 100 };
const chunk = { teaching: { paths: [{ id: "path", points: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: -2 }] }], zones: [{ id: "zone", kind: "stop", outline: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 1, y: 0, z: 2 }] }], signals: [] } } as unknown as Chunk;

test("priority plate projects world arms into the driver's view of the sign", () => {
  assert.deepEqual(R.mainRoadDirection("north", 0).toArray(), [0, 1]);
  const north = R.mainRoadDirection("north", Math.PI / 2);
  assert.ok(Math.abs(north.x - 1) < 1e-8);
  assert.ok(Math.abs(north.y) < 1e-8);
  const east = R.mainRoadDirection("east", Math.PI / 2);
  assert.ok(Math.abs(east.x) < 1e-8);
  assert.equal(east.y, -1);
});

test("bus has a longer, taller body than a car and needs no canvas", () => {
  const car = R.vehicleGeometry("blue");
  const bus = R.vehicleGeometry("bus");
  const carSize = new T.Box3().setFromObject(car).getSize(new T.Vector3());
  const busSize = new T.Box3().setFromObject(bus).getSize(new T.Vector3());
  assert.ok(busSize.z > carSize.z * 1.8);
  assert.ok(busSize.y > carSize.y * 1.5);
  R.dispose(car); R.dispose(bus);
});

test("picking respects walls, distance, invisible cars and ignored cockpit", () => {
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(72, 1, 0.05, 100);
  const sign = new T.Group();
  sign.userData.agent = agent;
  R.box(sign, 0, 0, -3, 1, 1, 0.1, 0xffff00);
  scene.add(sign);
  assert.equal(R.pickAgent(scene, camera), agent);
  const wall = R.box(scene, 0, 0, -1, 1, 1, 0.1, 0x888888);
  assert.equal(R.pickAgent(scene, camera), undefined);
  assert.equal(R.pickAgent(scene, camera, 0, 0, [wall]), agent);
  wall.visible = false;
  assert.equal(R.pickAgent(scene, camera), agent);
  sign.position.z = -3;
  assert.equal(R.pickAgent(scene, camera), undefined);
  R.dispose(scene);
});

test("hints use existing IDs, expire, and preserve target materials", () => {
  const scene = new T.Scene();
  const target = R.box(scene, 0, 1, -3, 1, 2, 0.1, 0xff0000);
  target.userData.objectId = "sign";
  const material = target.material;
  const layer = new R.HintLayer(scene);
  layer.apply([hint, { ...hint, objectIds: [], pathIds: ["missing"], zoneIds: [], durationMs: 200 }], [chunk], 10);
  assert.equal(layer.group.children.length, 3);
  assert.equal(target.material, material);
  let disposed = 0;
  layer.group.traverse(o => {
    if (o instanceof T.Mesh || o instanceof T.Line) o.geometry.addEventListener("dispose", () => disposed++);
  });
  layer.update(109);
  assert.equal(layer.group.children.length, 3);
  layer.update(110);
  assert.equal(layer.group.children.length, 0);
  assert.ok(disposed >= 3);
  assert.equal(target.material, material);
  layer.apply([{ ...hint, durationMs: -1 }], [chunk], 120);
  assert.equal(layer.group.children.length, 0);
  layer.apply([hint], [chunk], 120);
  layer.clear();
  assert.equal(layer.group.children.length, 0);
  R.dispose(scene);
});

test("shared resources and line geometries are disposed exactly once", () => {
  const root = new T.Group();
  const geometry = new T.BoxGeometry();
  const texture = new T.Texture();
  const material = new T.MeshBasicMaterial({ map: texture });
  root.add(new T.Mesh(geometry, material), new T.Mesh(geometry, material));
  const line = new T.Line(new T.BufferGeometry(), new T.LineBasicMaterial());
  root.add(line);
  let geometryCount = 0, materialCount = 0, textureCount = 0, lineCount = 0;
  geometry.addEventListener("dispose", () => geometryCount++);
  material.addEventListener("dispose", () => materialCount++);
  texture.addEventListener("dispose", () => textureCount++);
  line.geometry.addEventListener("dispose", () => lineCount++);
  R.dispose(root);
  assert.deepEqual([geometryCount, materialCount, textureCount, lineCount], [1, 1, 1, 1]);
});

test("overlapping hints expire on their own deadlines and follow moving targets", () => {
  const scene = new T.Scene();
  const target = R.box(scene, 0, 1, -3, 1, 2, 0.1, 0xff0000);
  target.userData.objectId = "sign";
  const layer = new R.HintLayer(scene);
  layer.apply([
    { ...hint, pathIds: [], zoneIds: [], durationMs: 10 },
    { ...hint, objectIds: [], pathIds: [], durationMs: 30 },
  ], [chunk], 0);
  target.position.x = 4;
  layer.update(5);
  const bounds = layer.group.children[0] as T.Box3Helper;
  assert.equal(bounds.box.min.x, 3.5);
  layer.update(10);
  assert.equal(layer.group.children.length, 1);
  layer.update(30);
  assert.equal(layer.group.children.length, 0);
  layer.apply([{ ...hint, pathIds: [], zoneIds: [] }], [chunk], 40);
  R.dispose(target);
  layer.update(41);
  assert.equal(layer.group.children.length, 0);
  R.dispose(scene);
});

test("cockpit and invisible parent groups do not occlude picking", () => {
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(72, 1, 0.05, 100);
  const sign = new T.Group();
  sign.userData.agent = agent;
  R.box(sign, 0, 0, -3, 1, 1, 0.1, 0xffff00);
  scene.add(sign);
  const cockpit = new T.Group();
  R.box(cockpit, 0, 0, -0.4, 1, 1, 0.1, 0x888888);
  scene.add(cockpit);
  assert.equal(R.pickAgent(scene, camera, 0, 0, [cockpit]), agent);
  cockpit.visible = false;
  assert.equal(R.pickAgent(scene, camera), agent);
  sign.visible = false;
  assert.equal(R.pickAgent(scene, camera), undefined);
  assert.equal(R.pickAgent(scene, camera, NaN, 0), undefined);
  R.dispose(scene);
});

test("cockpit leaves the road and horizon clear at desktop and narrow aspect ratios", () => {
  assert.equal(typeof R.cockpitGeometry, "function", "cockpit should be independently constructible without a WebGL context");
  const cockpit = R.cockpitGeometry();
  for (const aspect of [16 / 9, 4 / 3, 1]) {
    const camera = new T.PerspectiveCamera(72, aspect, 0.05, 180);
    camera.add(cockpit);
    camera.updateMatrixWorld(true);
    const ray = new T.Raycaster();
    for (const x of [-0.5, 0, 0.5])
      for (const y of [-0.45, 0, 0.45]) {
        ray.setFromCamera(new T.Vector2(x, y), camera);
        assert.equal(ray.intersectObject(cockpit, true).length, 0, `road must remain visible at ${x},${y}, aspect ${aspect}`);
      }
    ray.setFromCamera(new T.Vector2(-0.2, -0.85), camera);
    assert.ok(ray.intersectObject(cockpit, true).length > 0, "dashboard and wheel are still visible at the bottom");
  }
  R.dispose(cockpit);
});
