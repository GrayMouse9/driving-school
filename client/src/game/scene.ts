import * as T from "three";
import { rebaseLookYaw } from "./camera";
import type { Agent, Chunk, Player, Vehicle } from "../types";
const palette: Record<string, number> = {
  blue: 0x76bbda,
  yellow: 0xf1c45b,
  green: 0x59bca4,
};
function box(
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
export function dispose(root: T.Object3D) {
  root.traverse((object) => {
    if (object instanceof T.Mesh || object instanceof T.Sprite) {
      object.geometry?.dispose();
      const mats = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const mat of mats) {
        for (const value of Object.values(mat))
          if (value instanceof T.Texture) value.dispose();
        mat.dispose();
      }
    }
  });
  root.removeFromParent();
}
function label(text: string, color = "#193f49") {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const c = canvas.getContext("2d")!;
  c.fillStyle = color;
  c.beginPath();
  c.roundRect(8, 8, 496, 112, 25);
  c.fill();
  c.strokeStyle = "#c2e6df";
  c.lineWidth = 4;
  c.stroke();
  c.fillStyle = "white";
  c.font = "bold 44px sans-serif";
  c.textAlign = "center";
  c.fillText(text.slice(0, 20), 256, 82);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  const sprite = new T.Sprite(
    new T.SpriteMaterial({ map: texture, depthTest: false }),
  );
  sprite.scale.set(3.2, 0.8, 1);
  return sprite;
}
function car(variant: string) {
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
  const l = label("У", "#a94e40");
  l.position.set(0, 1.95, 0.2);
  g.add(l);
  return g;
}
function sign(agent: Agent) {
  const g = new T.Group();
  g.position.copy(agent.position);
  g.rotation.y = agent.yaw;
  box(g, 0, 1.3, 0, 0.12, 2.6, 0.12, 0x78858a);
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 320;
  const c = canvas.getContext("2d")!;
  c.clearRect(0, 0, 256, 320);
  c.fillStyle = agent.kind === "crosswalk" ? "#2775b7" : "#d94840";
  c.strokeStyle = "#fff";
  c.lineWidth = 12;
  c.beginPath();
  if (agent.kind === "yield") {
    c.moveTo(20, 20);
    c.lineTo(236, 20);
    c.lineTo(128, 220);
    c.closePath();
  } else if (agent.kind === "stop") {
    for (let i = 0; i < 8; i++) {
      const a = ((i + 0.5) * Math.PI) / 4;
      const x = 128 + 110 * Math.cos(a),
        y = 122 + 110 * Math.sin(a);
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.closePath();
  } else c.rect(18, 12, 220, 220);
  c.fill();
  c.stroke();
  if (agent.kind === "yield") {
    c.fillStyle = "#fff9dc";
    c.beginPath();
    c.moveTo(52, 44);
    c.lineTo(204, 44);
    c.lineTo(128, 180);
    c.closePath();
    c.fill();
  }
  c.fillStyle = "white";
  c.font = "bold 52px sans-serif";
  c.textAlign = "center";
  if (agent.kind === "stop") c.fillText("STOP", 128, 142);
  if (agent.kind === "crosswalk") {
    c.fillStyle = "#fff9e8";
    c.beginPath();
    c.moveTo(128, 36);
    c.lineTo(222, 205);
    c.lineTo(34, 205);
    c.closePath();
    c.fill();
    c.strokeStyle = "#273d45";
    c.lineWidth = 10;
    c.lineCap = "round";
    c.beginPath();
    c.arc(130, 91, 10, 0, Math.PI * 2);
    c.fillStyle = "#273d45";
    c.fill();
    c.beginPath();
    c.moveTo(128, 110);
    c.lineTo(116, 145);
    c.lineTo(94, 174);
    c.moveTo(116, 145);
    c.lineTo(148, 174);
    c.moveTo(123, 122);
    c.lineTo(150, 137);
    c.moveTo(123, 122);
    c.lineTo(101, 134);
    c.stroke();
    c.lineWidth = 5;
    for (const x of [75, 105, 135, 165]) {
      c.beginPath();
      c.moveTo(x, 190);
      c.lineTo(x + 18, 178);
      c.stroke();
    }
  }
  c.fillStyle = "#f4e9d5";
  c.beginPath();
  c.ellipse(128, 269, 47, 38, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#263b40";
  for (const x of [111, 145]) {
    c.beginPath();
    c.arc(x, 261, 5, 0, Math.PI * 2);
    c.fill();
  }
  c.beginPath();
  c.arc(128, 273, 16, 0.1, Math.PI - 0.1);
  c.strokeStyle = "#263b40";
  c.lineWidth = 3;
  c.stroke();
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  const face = new T.Mesh(
    new T.PlaneGeometry(1.2, 1.5),
    new T.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: T.DoubleSide,
    }),
  );
  face.position.set(0, 2.3, 0.09);
  g.add(face);
  return g;
}
export class GameScene {
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(72, 1, 0.05, 180);
  readonly renderer: T.WebGLRenderer;
  readonly chunks = new Map<string, { data: Chunk; group: T.Group }>();
  private cars = new Map<string, T.Group>();
  private walkers = new Map<string, T.Group>();
  private cockpit = new T.Group();
  private targets: Vehicle[] = [];
  private players: Player[] = [];
  selfId = "";
  lookYaw = 0;
  lookPitch = 0;
  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.scene.background = new T.Color(0xbcdbe6);
    this.scene.fog = new T.Fog(0xbcdbe6, 65, 150);
    this.scene.add(new T.HemisphereLight(0xfff6dd, 0x839f85, 2.4));
    const sun = new T.DirectionalLight(0xffe6bd, 3);
    sun.position.set(35, 65, 20);
    this.scene.add(sun);
    this.camera.position.set(0, 1.5, 8);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);
    box(this.cockpit, 0, -0.65, -0.5, 1.85, 0.4, 0.65, 0x293a3d);
    box(this.cockpit, 0, -0.48, -1.2, 1.8, 0.06, 0.75, 0x76bbda);
    for (const x of [-0.84, 0.84]) {
      const p = box(this.cockpit, x, 0.02, -0.85, 0.08, 1.3, 0.09, 0xd9d8cb);
      p.rotation.z = x > 0 ? -0.15 : 0.15;
    }
    const wheel = new T.Mesh(
      new T.TorusGeometry(0.22, 0.028, 8, 32),
      new T.MeshStandardMaterial({ color: 0x1c292c }),
    );
    wheel.position.set(-0.3, -0.4, -0.65);
    this.cockpit.add(wheel);
    this.camera.add(this.cockpit);
    this.cockpit.visible = false;
    window.addEventListener("resize", () => this.resize());
    this.resize();
  }
  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }
  addChunk(data: Chunk) {
    this.removeChunk(data.id);
    const g = new T.Group();
    box(
      g,
      data.origin.x + data.size / 2,
      -0.16,
      data.origin.z + data.size / 2,
      data.size,
      0.25,
      data.size,
      0x9dc690,
    );
    for (const road of data.roads) {
      const r = new T.Group();
      r.position.copy(road.position);
      r.rotation.y = road.yaw;
      box(r, 0, 0.005, 0, road.width, 0.08, road.length, 0x687579);
      for (const x of [-1, 1])
        box(
          r,
          x * (road.width / 2 + 0.7),
          0.09,
          0,
          1.4,
          0.2,
          road.length,
          0xe5dfcb,
        );
      for (let z = -road.length / 2 + 2; z < road.length / 2; z += 6)
        box(r, 0, 0.06, z, 0.12, 0.012, 2.8, 0xfff7d5);
      g.add(r);
    }
    for (const obj of data.objects) {
      const o = new T.Group();
      o.position.copy(obj.position);
      o.rotation.y = obj.yaw;
      if (obj.kind === "tree") {
        box(o, 0, 1, 0, 0.35, 2, 0.35, 0x937355);
        const crown = new T.Mesh(
          new T.IcosahedronGeometry(Math.max(obj.size.x, 1.5), 0),
          new T.MeshStandardMaterial({ color: obj.color }),
        );
        crown.position.y = 3;
        o.add(crown);
      } else {
        box(
          o,
          0,
          obj.size.y / 2,
          0,
          obj.size.x,
          obj.size.y,
          obj.size.z,
          obj.color,
        );
        box(
          o,
          0,
          obj.size.y + 0.15,
          0,
          obj.size.x + 0.3,
          0.3,
          obj.size.z + 0.3,
          0xc78264,
        );
        for (let x = -obj.size.x / 2 + 1; x < obj.size.x / 2; x += 2)
          for (let y = 1.8; y < obj.size.y; y += 2.6)
            box(o, x, y, obj.size.z / 2 + 0.015, 0.7, 1, 0.04, 0x638b94);
      }
      g.add(o);
    }
    for (const agent of data.agents) g.add(sign(agent));
    this.chunks.set(data.id, { data, group: g });
    this.scene.add(g);
  }
  removeChunk(id: string) {
    const old = this.chunks.get(id);
    if (old) {
      dispose(old.group);
      this.chunks.delete(id);
    }
  }
  private cameraInitialized = false;
  private cameraVehicleId: string | null = null;
  private cameraVehicleYaw = 0;
  snapshot(players: Player[], vehicles: Vehicle[]) {
    const self = players.find((p) => p.id === this.selfId);
    const nextVehicle = vehicles.find((v) => v.id === self?.vehicleId);
    if (self) {
      if (!this.cameraInitialized) this.lookYaw = nextVehicle ? 0 : self.yaw;
      else if (this.cameraVehicleId !== self.vehicleId)
        this.lookYaw = rebaseLookYaw(
          this.lookYaw,
          this.cameraVehicleId ? this.cameraVehicleYaw : 0,
          nextVehicle?.yaw ?? 0,
        );
      this.cameraInitialized = true;
      this.cameraVehicleId = self.vehicleId;
      this.cameraVehicleYaw = nextVehicle?.yaw ?? 0;
    } else {
      this.cameraInitialized = false;
      this.cameraVehicleId = null;
      this.cameraVehicleYaw = 0;
    }

    this.players = players;
    this.targets = vehicles;
    const ids = new Set(vehicles.map((v) => v.id));
    for (const [id, g] of this.cars)
      if (!ids.has(id)) {
        dispose(g);
        this.cars.delete(id);
      }
    for (const v of vehicles)
      if (!this.cars.has(v.id)) {
        const g = car(v.variant);
        g.position.copy(v.position);
        g.rotation.y = v.yaw;
        this.cars.set(v.id, g);
        this.scene.add(g);
      }
    for (const v of vehicles) {
      const g = this.cars.get(v.id)!;
      const driver = players.find((p) => p.id === v.driverId);
      const old = g.getObjectByName("driver-label");
      if (old?.userData.driver !== driver?.id) {
        if (old) dispose(old);
        if (driver) {
          const l = label(driver.username);
          l.name = "driver-label";
          l.userData.driver = driver.id;
          l.position.set(0, 2.8, 0);
          g.add(l);
        }
      }
    }
    const walkers = new Set(
      players
        .filter((p) => p.mode === "onFoot" && p.id !== this.selfId)
        .map((p) => p.id),
    );
    for (const [id, g] of this.walkers)
      if (!walkers.has(id)) {
        dispose(g);
        this.walkers.delete(id);
      }
    for (const p of players)
      if (walkers.has(p.id)) {
        let g = this.walkers.get(p.id);
        if (!g) {
          g = new T.Group();
          box(g, 0, 0.8, 0, 0.5, 1.4, 0.4, 0xdaa15b);
          const l = label(p.username);
          l.position.y = 2.1;
          g.add(l);
          this.walkers.set(p.id, g);
          this.scene.add(g);
        }
        g.position.copy(p.position);
      }
  }
  get self() {
    return this.players.find((p) => p.id === this.selfId);
  }
  get ownVehicle() {
    return this.targets.find((v) => v.id === this.self?.vehicleId);
  }
  nearestAgent() {
    const p = this.self;
    if (!p) return;
    return [...this.chunks.values()]
      .flatMap((c) => c.data.agents)
      .filter(
        (a) =>
          Math.hypot(a.position.x - p.position.x, a.position.z - p.position.z) <
          5,
      )
      .sort(
        (a, b) =>
          Math.hypot(a.position.x - p.position.x, a.position.z - p.position.z) -
          Math.hypot(b.position.x - p.position.x, b.position.z - p.position.z),
      )[0];
  }
  nearestVehicle() {
    const p = this.self;
    if (!p) return;
    return this.targets.find(
      (v) =>
        !v.driverId &&
        Math.hypot(v.position.x - p.position.x, v.position.z - p.position.z) <
          4,
    );
  }
  render(dt: number) {
    const alpha = 1 - Math.exp(-dt * 14);
    for (const v of this.targets) {
      const g = this.cars.get(v.id)!;
      g.visible = v.id !== this.self?.vehicleId;
      g.position.lerp(
        new T.Vector3(v.position.x, v.position.y, v.position.z),
        alpha,
      );
      g.rotation.y +=
        Math.atan2(
          Math.sin(v.yaw - g.rotation.y),
          Math.cos(v.yaw - g.rotation.y),
        ) * alpha;
    }
    const self = this.self;
    this.cockpit.visible = !!self?.vehicleId;
    if (self) {
      const v = this.ownVehicle;
      const pos = v?.position ?? self.position;
      const yaw = v?.yaw ?? self.yaw;
      const offset = new T.Vector3(-0.3, 1.5, 0.25).applyAxisAngle(
        new T.Vector3(0, 1, 0),
        yaw,
      );
      if (v)
        this.camera.position.lerp(
          new T.Vector3(pos.x, pos.y, pos.z).add(offset),
          alpha,
        );
      else
        this.camera.position.lerp(
          new T.Vector3(pos.x, pos.y + 1.65, pos.z),
          alpha,
        );
      this.camera.rotation.set(
        this.lookPitch,
        v ? yaw + this.lookYaw : this.lookYaw,
        0,
        "YXZ",
      );
    }
    this.renderer.render(this.scene, this.camera);
  }
}
