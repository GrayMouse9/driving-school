import * as T from "three";
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {Agent} from "../entities/types";
import type {Chunk} from "../world/types";
import type { VisualHint, SignalState } from "../../network/protocol";
const palette: Record<string, number> = {
  blue: 0x76bbda,
  yellow: 0xf1c45b,
  green: 0x59bca4,
};
export function box(
  parent: T.Object3D,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  color: T.ColorRepresentation,
) {
  const mesh = new T.Mesh(
    new T.BoxGeometry(sx, sy, sz),
    new T.MeshStandardMaterial({ color, roughness: 0.85 }),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
export function vehicleGeometry(variant: string) {
  if (variant === "bus") return busGeometry();
  const g = new T.Group();
  const color = palette[variant] ?? palette.blue;
  box(g, 0, 0.65, 0, 1.8, 0.65, 3.7, color);
  box(g, 0, 1.18, 0.2, 1.6, 0.65, 1.8, 0x254955);
  box(g, 0, 1.53, 0.2, 1.7, 0.12, 1.9, color);
  box(g, 0, 0.85, -1.85, 1.5, 0.2, 0.05, 0xfff0c1);
  box(g, 0, 0.85, 1.85, 1.5, 0.18, 0.05, 0xd65745);
  for (const x of [-0.95, 0.95])
    for (const z of [-1.15, 1.15]) {
      const wheel = new T.Mesh(
        new T.CylinderGeometry(0.36, 0.36, 0.22, 12),
        new T.MeshStandardMaterial({ color: 0x283238 }),
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.38, z);
      g.add(wheel);
    }
  return g;
}

type Road = Chunk["roads"][number];
type Zone = NonNullable<Chunk["teaching"]>["zones"][number];
type Point = { x: number; y: number; z: number };

function roadPoint(road: Road, point: Pick<Point, "x" | "z">) {
  const x = point.x - road.position.x, z = point.z - road.position.z;
  const c = Math.cos(road.yaw), s = Math.sin(road.yaw);
  return new T.Vector2(c * x - s * z, s * x + c * z);
}
function roadOutline(road: Road) {
  const c = Math.cos(road.yaw), s = Math.sin(road.yaw);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
    const x = a * road.width / 2, z = b * road.length / 2;
    return { x: road.position.x + c * x + s * z, z: road.position.z - s * x + c * z };
  });
}

// Clip in the road's local plane, so translated/rotated roads use the same
// overlap calculation. No intersection coordinates or scenario IDs are baked in.
function clipX(polygon: T.Vector2[], edge: number, greater: boolean) {
  const result: T.Vector2[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const aInside = greater ? a.x >= edge : a.x <= edge;
    const bInside = greater ? b.x >= edge : b.x <= edge;
    if (aInside) result.push(a);
    if (aInside !== bInside) result.push(new T.Vector2(edge, a.y + (b.y - a.y) * (edge - a.x) / (b.x - a.x)));
  }
  return result;
}
function stripOverlap(polygon: T.Vector2[], x: number, width: number): [number, number][] {
  const clipped = clipX(clipX(polygon, x - width / 2, true), x + width / 2, false);
  return clipped.length < 3 ? [] : [[Math.min(...clipped.map(p => p.y)), Math.max(...clipped.map(p => p.y))]];
}
function uncut(start: number, end: number, cuts: [number, number][]) {
  const segments: [number, number][] = [];
  let cursor = start;
  for (const [a, b] of [...cuts].sort((a, b) => a[0] - b[0])) {
    if (b <= cursor || a >= end) continue;
    if (a > cursor) segments.push([cursor, a]);
    cursor = Math.max(cursor, b);
    if (cursor >= end) break;
  }
  if (cursor < end) segments.push([cursor, end]);
  return segments;
}

export function roadGeometry(road: Road, localRoads: Road[], zones: Zone[] = []) {
  const group = new T.Group();
  group.userData.objectId = road.id;
  group.position.copy(road.position);
  group.rotation.y = road.yaw;
  box(group, 0, 0.005, 0, road.width, 0.08, road.length, 0x687579);
  const overlaps = localRoads.filter(other => other !== road).map(other => roadOutline(other).map(p => roadPoint(road, p)));
  for (const side of [-1, 1]) {
    const x = side * (road.width / 2 + 0.7);
    const cuts = overlaps.flatMap(p => stripOverlap(p, x, 1.4));
    for (const [a, b] of uncut(-road.length / 2, road.length / 2, cuts))
      if (b - a > 0.001) box(group, x, 0.09, (a + b) / 2, 1.4, 0.2, b - a, 0xe5dfcb);
  }
  const crossings = zones.filter(z => z.kind === "crosswalk" && z.outline.length >= 3 && finitePoints(z.outline))
    .map(z => z.outline.map(p => roadPoint(road, p)));
  const cuts = [...overlaps, ...crossings].flatMap(p => stripOverlap(p, 0, 0.12));
  for (let z = -road.length / 2 + 2; z < road.length / 2; z += 6)
    for (const [a, b] of uncut(Math.max(-road.length / 2, z - 1.4), Math.min(road.length / 2, z + 1.4), cuts))
      if (b - a > 0.001) box(group, 0, 0.06, (a + b) / 2, 0.12, 0.012, b - a, 0xfff7d5);
  const batches=new Map<number,T.Mesh<T.BufferGeometry,T.MeshStandardMaterial>[]>();
  for(const child of [...group.children]){
    const mesh=child as T.Mesh<T.BufferGeometry,T.MeshStandardMaterial>;
    const key=mesh.material.color.getHex();const list=batches.get(key)??[];list.push(mesh);batches.set(key,list);
  }
  for(const meshes of batches.values()){
    if(meshes.length<2)continue;
    const transformed=meshes.map(mesh=>{mesh.updateMatrix();return mesh.geometry.clone().applyMatrix4(mesh.matrix);});
    const geometry=mergeGeometries(transformed,false);
    for(const source of transformed)source.dispose();
    if(!geometry)continue;
    const material=meshes[0].material;
    for(const mesh of meshes){group.remove(mesh);mesh.geometry.dispose();if(mesh.material!==material)mesh.material.dispose();}
    const batch=new T.Mesh(geometry,material);batch.castShadow=true;batch.receiveShadow=true;group.add(batch);
  }
  return group;
}

export function crosswalkGeometry(zone: Zone, roads: Road[]) {
  if (zone.kind !== "crosswalk" || zone.outline.length < 3 || !finitePoints(zone.outline) || !roads.length) return;
  const center = zone.outline.reduce<T.Vector3>((sum, p) => sum.add(new T.Vector3(p.x, p.y, p.z)), new T.Vector3())
    .divideScalar(zone.outline.length);
  // The nearest finite road centreline gives the stripe direction. Teaching
  // geometry supplies the entire painted extent; signs never invent a zebra.
  const distance = (road: Road) => {
    const p = roadPoint(road, center);
    return p.x ** 2 + Math.max(0, Math.abs(p.y) - road.length / 2) ** 2;
  };
  const road = [...roads].sort((a, b) => distance(a) - distance(b))[0];
  const polygon = zone.outline.map(p => roadPoint(road, p));
  const min = Math.min(...polygon.map(p => p.x)), max = Math.max(...polygon.map(p => p.x));
  const group = new T.Group();
  group.userData.objectId = zone.id;
  group.position.set(road.position.x, Math.max(road.position.y, center.y) + 0.075, road.position.z);
  group.rotation.y = road.yaw;
  const material = new T.MeshStandardMaterial({ color: 0xfff4df, roughness: 0.95, side: T.DoubleSide });
  const vertices: number[] = [], indices: number[] = [];
  const count = Math.max(1, Math.floor((max - min) / 1.1));
  const spacing = (max - min) / count;
  for (let i = 0; i < count; i++) {
    const x = min + (i + 0.5) * spacing;
    const stripe = clipX(clipX(polygon, x - spacing * 0.26, true), x + spacing * 0.26, false);
    const offset = vertices.length / 3;
    vertices.push(...stripe.flatMap(p => [p.x, 0, p.y]));
    for (const triangle of T.ShapeUtils.triangulateShape(stripe, [])) indices.push(...triangle.map(j => j + offset));
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const paint = new T.Mesh(geometry, material);
  paint.receiveShadow = true;
  group.add(paint);
  return group;
}

export function teachingMarker(marker: { id: string; label: string; position: Point }) {
  const group = new T.Group();
  group.userData.objectId = marker.id;
  group.position.copy(marker.position);
  const disc = new T.Mesh(new T.CircleGeometry(0.42, 20), new T.MeshStandardMaterial({
    color: 0xe9b560, roughness: 1, transparent: true, opacity: 0.85, depthWrite: false,
  }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.085;
  group.add(disc);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#254955";
  context.beginPath();
  context.roundRect(8, 8, 112, 112, 26);
  context.fill();
  context.strokeStyle = "#ffe1a5";
  context.lineWidth = 5;
  context.stroke();
  context.fillStyle = "#fff8e8";
  context.font = "bold 82px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(marker.label.slice(0, 3), 64, 69, 102);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  const sprite = new T.Sprite(new T.SpriteMaterial({ map: texture, depthWrite: false }));
  sprite.scale.set(0.8, 0.8, 1);
  sprite.position.y = 0.9;
  group.add(sprite);
  return group;
}

export function cockpitGeometry() {
  const group = new T.Group();
  group.userData.pickIgnore = true;
  // Keep the bonnet, dash and wheel in the bottom quarter of the view.
  box(group, 0, -0.85, -0.78, 1.85, 0.35, 0.42, 0x293a3d);
  box(group, 0, -0.68, -1.35, 1.72, 0.06, 0.55, 0x76bbda);
  box(group, -0.3, -0.74, -1.01, 0.48, 0.15, 0.025, 0x193f49);
  for (const x of [-1.02, 1.02]) {
    const pillar = box(group, x, -0.14, -0.97, 0.065, 1.12, 0.08, 0xd7d4bf);
    pillar.rotation.z = x > 0 ? -0.12 : 0.12;
  }
  const wheel = new T.Mesh(new T.TorusGeometry(0.2, 0.026, 8, 24), new T.MeshStandardMaterial({ color: 0x1c292c }));
  wheel.position.set(-0.3, -0.62, -0.92);
  group.add(wheel);
  return group;
}

export function sceneryGeometry(object: Chunk["objects"][number]) {
  const group = new T.Group();
  group.userData.objectId = object.id;
  group.position.copy(object.position);
  group.rotation.y = object.yaw;
  const { x: width, y: height, z: depth } = object.size;
  if (object.kind === "observer") {
    group.add(observerGeometry(object.color));
  } else if (object.kind === "bus" || object.kind === "pedestrian") {
    group.add(object.kind === "bus" ? vehicleGeometry("bus") : pedestrianGeometry());
  } else if (object.kind === "tree") {
    const trunk = new T.Mesh(new T.CylinderGeometry(Math.min(width, depth) * 0.07, Math.min(width, depth) * 0.1, height * 0.48, 5),
      new T.MeshStandardMaterial({ color: 0x937355, roughness: 1 }));
    trunk.position.y = height * 0.24;
    group.add(trunk);
    const foliage = new T.IcosahedronGeometry(1, 0);
    const material = new T.MeshStandardMaterial({ color: object.color, roughness: 1, flatShading: true });
    for (const [y, radius, vertical] of [[0.62, 0.5, 0.28], [0.8, 0.38, 0.2]]) {
      const crown = new T.Mesh(foliage, material);
      crown.position.y = height * y;
      crown.scale.set(width * radius, height * vertical, depth * radius);
      crown.castShadow = true;
      group.add(crown);
    }
  } else {
    box(group, 0, height / 2, 0, width, height, depth, object.color);
    const roof = box(group, 0, height + 0.24, 0, width + 0.35, 0.48, depth + 0.35, 0xb98c72);
    const positions = roof.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++)
      if (positions.getY(i) > 0) positions.setXYZ(i, positions.getX(i) * 0.86, positions.getY(i), positions.getZ(i) * 0.86);
    positions.needsUpdate = true;
    roof.geometry.computeVertexNormals();
    // One local geometry/material for all windows; no textures or global cache
    // survives chunk eviction. Four facades remain cheap at city-block scale.
    const vertices: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[]) => vertices.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let y = 1.8; y < height - 0.5; y += 2.6) {
      for (const side of [-1, 1]) {
        const z = side * (depth / 2 + 0.02), x = side * (width / 2 + 0.02);
        for (let u = -width / 2 + 1; u < width / 2 - 0.5; u += 2)
          quad([u - 0.35, y - 0.5, z], [u + 0.35, y - 0.5, z], [u + 0.35, y + 0.5, z], [u - 0.35, y + 0.5, z]);
        for (let u = -depth / 2 + 1; u < depth / 2 - 0.5; u += 2)
          quad([x, y - 0.5, u + 0.35], [x, y - 0.5, u - 0.35], [x, y + 0.5, u - 0.35], [x, y + 0.5, u + 0.35]);
      }
    }
    if (vertices.length) {
      const geometry = new T.BufferGeometry();
      geometry.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
      geometry.computeVertexNormals();
      group.add(new T.Mesh(geometry, new T.MeshStandardMaterial({ color: 0x638b94, roughness: 0.65, side: T.DoubleSide })));
    }
  }
  return group;
}

// Each constructed group owns its resources. Deduplicate shared geometry/maps
// within the group so overlays and repeated meshes can be released safely.
export function dispose(root: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>();
  const materials = new Set<T.Material>();
  const textures = new Set<T.Texture>();
  root.traverse(object => {
    if (object instanceof T.Mesh || object instanceof T.Sprite || object instanceof T.Line) {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material))
          if (value instanceof T.Texture) textures.add(value);
      }
    }
  });
  for (const resource of [...geometries, ...textures, ...materials]) resource.dispose();
  root.removeFromParent();
}

function busGeometry() {
  const g = new T.Group();
  box(g, 0, 1.65, 0, 2.5, 2.5, 8.5, 0xf1c45b);
  box(g, 0, 2.1, -4.27, 2.25, 1.35, 0.05, 0x254955);
  box(g, 0, 2.1, 4.27, 2.25, 1.3, 0.05, 0x254955);
  for (const x of [-1.27, 1.27])
    for (const z of [-3.1, -1.55, 0, 1.55, 3.1])
      box(g, x, 2.12, z, 0.05, 1.25, 1.3, 0x254955);
  for (const x of [-1.27, 1.27])
    for (const z of [-2.7, 2.7]) {
      const wheel = new T.Mesh(new T.CylinderGeometry(0.5, 0.5, 0.25, 12), new T.MeshStandardMaterial({ color: 0x283238 }));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.5, z);
      g.add(wheel);
    }
  for (const x of [-0.9, 0.9]) {
    box(g, x, 0.9, -4.29, 0.35, 0.24, 0.05, 0xfff0c1);
    box(g, x, 0.9, 4.29, 0.35, 0.24, 0.05, 0xd65745);
  }
  return g;
}

type Arm = 'north' | 'east' | 'south' | 'west';
const directions: Record<Arm, [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
// The sign's front is local +Z. Diagram up is away from the viewer;
// mainRoadArms are world compass directions, not plate-relative labels.
export function mainRoadDirection(arm: Arm, yaw: number) {
  const [x, z] = directions[arm];
  return new T.Vector2(Math.cos(yaw) * x - Math.sin(yaw) * z, -(Math.sin(yaw) * x + Math.cos(yaw) * z));
}

export function mainRoadPlate(arms: Arm[], yaw: number) {
  const group = new T.Group();
  box(group, 0, 0, 0, 0.96, 0.76, 0.05, 0x273d45);
  box(group, 0, 0, 0.035, 0.89, 0.69, 0.025, 0xfff9e8);
  for (const arm of Object.keys(directions) as Arm[]) {
    const direction = mainRoadDirection(arm, yaw);
    const road = box(group, direction.x * 0.145, direction.y * 0.145, 0.06,
      arms.includes(arm) ? 0.105 : 0.035, 0.34, 0.025, 0x273d45);
    road.rotation.z = -Math.atan2(direction.x, direction.y);
  }
  return group;
}

export function priorityFace() {
  const group = new T.Group();
  const border = box(group, 0, 0, 0, 0.86, 0.86, 0.06, 0x273d45);
  border.rotation.z = Math.PI / 4;
  const white = box(group, 0, 0, 0.04, 0.81, 0.81, 0.025, 0xfff9e8);
  white.rotation.z = Math.PI / 4;
  const yellow = box(group, 0, 0, 0.065, 0.65, 0.65, 0.025, 0xf7cf38);
  yellow.rotation.z = Math.PI / 4;
  return group;
}

export function pedestrianGeometry() {
  const g = new T.Group();
  box(g, 0, 1.03, 0, 0.42, 0.65, 0.3, 0xd98150);
  const head = new T.Mesh(new T.SphereGeometry(0.19, 10, 8), new T.MeshStandardMaterial({ color: 0xf2cfad }));
  head.position.y = 1.57;
  g.add(head);
  for (const x of [-0.13, 0.13]) {
    box(g, x, 0.36, 0, 0.15, 0.72, 0.2, 0x294c66);
    box(g, x * 2.25, 1.02, 0, 0.12, 0.58, 0.16, 0xf2cfad);
  }
  return g;
}

function observerGeometry(color: string) {
  const body=pedestrianGeometry();
  (body.children[0] as T.Mesh<T.BufferGeometry,T.MeshStandardMaterial>).material.color.set(color);
  const skull=body.children[1] as T.Mesh;
  body.remove(skull);
  const head=new T.Group();head.name='observer-head';head.position.y=1.38;
  skull.position.y-=head.position.y;head.add(skull);
  for(const x of [-.075,.075]) {
    const white=new T.Mesh(new T.SphereGeometry(1,8,6),new T.MeshStandardMaterial({color:0xffffff}));
    white.position.set(x,.23,-.166);white.scale.set(.063,.046,.035);head.add(white);
    const pupil=new T.Mesh(new T.SphereGeometry(.025,8,6),new T.MeshStandardMaterial({color:0x263541}));
    pupil.position.set(x,.23,-.199);pupil.scale.z=.55;head.add(pupil);
  }
  box(head,0,.15,-.2,.06,.08,.08,0xf2cfad);
  batchObserverParts(body);batchObserverParts(head);
  body.add(head);
  return body;
}

function batchObserverParts(group:T.Group) {
  const batches=new Map<number,T.Mesh<T.BufferGeometry,T.MeshStandardMaterial>[]>();
  for(const child of group.children){
    const mesh=child as T.Mesh<T.BufferGeometry,T.MeshStandardMaterial>;
    const key=mesh.material.color.getHex(),list=batches.get(key)??[];list.push(mesh);batches.set(key,list);
  }
  for(const meshes of batches.values()){
    if(meshes.length<2)continue;
    const parts=meshes.map(mesh=>{mesh.updateMatrix();return mesh.geometry.clone().applyMatrix4(mesh.matrix);});
    const merged=mergeGeometries(parts,false);for(const part of parts)part.dispose();
    if(!merged)continue;
    const material=meshes[0].material;
    for(const mesh of meshes){group.remove(mesh);mesh.geometry.dispose();if(mesh.material!==material)mesh.material.dispose();}
    group.add(new T.Mesh(merged,material));
  }
  return group;
}

export function signalGeometry() {
  const group = new T.Group();
  box(group, 0, 1.4, 0, 0.1, 2.8, 0.1, 0x78858a);
  box(group, 0, 2.55, 0, 0.4, 1.1, 0.3, 0x273238);
  for (const [i, aspect] of ['red', 'yellow', 'green'].entries()) {
    const lamp = new T.Mesh(new T.CircleGeometry(0.12, 16), new T.MeshBasicMaterial({ color: 0x343a3b, side: T.DoubleSide }));
    lamp.name = aspect;
    lamp.position.set(0, 2.89 - i * 0.34, 0.16);
    group.add(lamp);
  }
  return group;
}
export function setSignalAspect(group: T.Group, aspect?: SignalState['aspect']) {
  const colors = { red: 0xf2483c, yellow: 0xffd43b, green: 0x58e68c };
  for (const name of ['red', 'yellow', 'green'] as const) {
    const lamp = group.getObjectByName(name) as T.Mesh<T.CircleGeometry, T.MeshBasicMaterial>;
    lamp.material.color.setHex(name === aspect ? colors[name] : 0x343a3b);
  }
}

function pickObject(scene: T.Scene, camera: T.Camera, ndcX: number, ndcY: number, ignored: T.Object3D[]) {
  if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY) || Math.abs(ndcX) > 1 || Math.abs(ndcY) > 1) return;
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const candidates: T.Object3D[] = [];
  const visit = (object: T.Object3D) => {
    if (!object.visible || object.userData.pickIgnore || ignored.includes(object)) return;
    if (object instanceof T.Mesh) candidates.push(object);
    for (const child of object.children) visit(child);
  };
  visit(scene);
  const ray = new T.Raycaster();
  ray.far = 5;
  ray.setFromCamera(new T.Vector2(ndcX, ndcY), camera);
  for (const hit of ray.intersectObjects(candidates, false)) {
    const mesh = hit.object as T.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.every(m => !m.visible || (m.transparent && m.opacity === 0))) continue;
    return hit.object; // The nearest opaque world mesh occludes farther objects.
  }
}

export function pickObjectId(scene: T.Scene, camera: T.Camera, ndcX = 0, ndcY = 0, ignored: T.Object3D[] = []): string | undefined {
  for (let object: T.Object3D | null | undefined = pickObject(scene, camera, ndcX, ndcY, ignored); object; object = object.parent)
    if (typeof object.userData.objectId === "string") return object.userData.objectId;
}

export function pickAgent(scene: T.Scene, camera: T.Camera, ndcX = 0, ndcY = 0, ignored: T.Object3D[] = []): Agent | undefined {
  for (let object: T.Object3D | null | undefined = pickObject(scene, camera, ndcX, ndcY, ignored); object; object = object.parent)
    if (object.userData.agent) return object.userData.agent as Agent;
}

function finitePoints(points: { x: number; y: number; z: number }[]) {
  return points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
}
function teachingLine(points: { x: number; y: number; z: number }[], closed = false) {
  const vertices = points.map(p => new T.Vector3(p.x, p.y + 0.12, p.z));
  const geometry = new T.BufferGeometry().setFromPoints(vertices);
  const material = new T.LineBasicMaterial({ color: closed ? 0xffab42 : 0xffef63, depthTest: true });
  return closed ? new T.LineLoop(geometry, material) : new T.Line(geometry, material);
}

export class HintLayer {
  readonly group = new T.Group();
  private entries: { object: T.Object3D; expires: number; target?: T.Object3D }[] = [];
  constructor(private scene: T.Scene) {
    this.group.userData.pickIgnore = true;
    scene.add(this.group);
  }
  clear() {
    for (const child of [...this.group.children]) dispose(child);
    this.entries = [];
  }
  apply(hints: VisualHint[], chunks: Chunk[], now = performance.now()) {
    this.clear();
    this.scene.updateMatrixWorld(true);
    const objects = new Map<string, T.Object3D>();
    this.scene.traverse(object => {
      if (typeof object.userData.objectId === 'string') objects.set(object.userData.objectId, object);
    });
    const paths = new Map(chunks.flatMap(c => c.teaching?.paths ?? []).map(p => [p.id, p]));
    const zones = new Map(chunks.flatMap(c => c.teaching?.zones ?? []).map(z => [z.id, z]));
    const add = (object: T.Object3D, expires: number, target?: T.Object3D) => {
      this.group.add(object);
      this.entries.push({ object, expires, target });
    };
    for (const hint of hints) {
      if (hint.kind !== 'highlight' || !Number.isFinite(hint.durationMs) || hint.durationMs <= 0) continue;
      const expires = now + hint.durationMs;
      for (const id of new Set(hint.objectIds)) {
        const target = objects.get(id);
        if (!target) continue;
        const bounds = new T.Box3().setFromObject(target);
        if (!bounds.isEmpty()) add(new T.Box3Helper(bounds, 0xffe45e), expires, target);
      }
      for (const id of new Set(hint.pathIds)) {
        const path = paths.get(id);
        if (path && path.points.length >= 2 && finitePoints(path.points)) add(teachingLine(path.points), expires);
      }
      for (const id of new Set(hint.zoneIds)) {
        const zone = zones.get(id);
        if (zone && zone.outline.length >= 3 && finitePoints(zone.outline)) add(teachingLine(zone.outline, true), expires);
      }
    }
  }
  update(now = performance.now()) {
    this.entries = this.entries.filter(entry => {
      if (now >= entry.expires || (entry.target && !this.scene.getObjectById(entry.target.id))) {
        dispose(entry.object);
        return false;
      }
      if (entry.target) {
        entry.object.visible = entry.target.visible;
        (entry.object as T.Box3Helper).box.setFromObject(entry.target);
      }
      return true;
    });
  }
}
