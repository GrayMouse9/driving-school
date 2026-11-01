import * as T from "three";
import { box, dispose, vehicleGeometry, priorityFace, mainRoadPlate,
  pedestrianGeometry, signalGeometry, setSignalAspect, HintLayer,
  roadGeometry, crosswalkGeometry, teachingMarker, cockpitGeometry, sceneryGeometry,
  pickObjectId as raycastObjectId, pickAgent as raycastAgent } from "./renderer";
import type { VisualHint, PedestrianState, SignalState } from "../../network/protocol";
export { dispose } from "./renderer";
import type {Agent, Player, Vehicle} from "../entities/types";
import type {Chunk} from "../world/types";
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
function sign(agent: Agent) {
  const g = new T.Group();
  g.userData.agent = agent;
  g.userData.objectId = agent.id;
  g.position.copy(agent.position);
  g.rotation.y = agent.yaw;
  box(g, 0, 1.3, 0, 0.12, 2.6, 0.12, 0x78858a);
  if (agent.kind === "priority") {
    const face = priorityFace();
    face.position.set(0, 2.5, 0.09);
    g.add(face);
    if (agent.mainRoadArms?.length) {
      const plate = mainRoadPlate(agent.mainRoadArms, agent.yaw);
      plate.position.set(0, 1.4, 0.1);
      g.add(plate);
    }
    return g;
  }
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
  if (agent.mainRoadArms?.length) {
    const plate = mainRoadPlate(agent.mainRoadArms, agent.yaw);
    plate.position.set(0, 1.1, 0.1);
    g.add(plate);
  }
  return g;
}
export class GameScene {
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(72, 1, 0.05, 180);
  readonly renderer: T.WebGLRenderer;
  readonly chunks = new Map<string, { data: Chunk; group: T.Group }>();
  private cars = new Map<string, T.Group>();
  private pedestrians = new Map<string, T.Group>();
  private signals = new Map<string, T.Group>();
  private signalStates = new Map<string, SignalState["aspect"]>();
  private hints: HintLayer;
  private readonly onResize = () => this.resize();
  private cockpit = cockpitGeometry();
  private targets: Vehicle[] = [];
  private players: Player[] = [];
  selfId = "";
  lookYaw = 0;
  lookPitch = 0;
  constructor(readonly canvas: HTMLCanvasElement) {
    this.hints = new HintLayer(this.scene);
    this.cockpit.userData.pickIgnore = true;
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.scene.background = new T.Color(0xbcdbe6);
    this.scene.fog = new T.Fog(0xbcdbe6, 38, 85);
    this.scene.add(new T.HemisphereLight(0xfff6dd, 0x839f85, 2.4));
    const sun = new T.DirectionalLight(0xffe6bd, 3);
    sun.position.set(35, 65, 20);
    this.scene.add(sun);
    this.camera.position.set(0, 1.5, 8);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);
    this.camera.add(this.cockpit);
    this.cockpit.visible = false;
    window.addEventListener("resize", this.onResize);
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
    for (const road of data.roads) g.add(roadGeometry(road, data.roads, data.teaching?.zones));
    for (const zone of data.teaching?.zones ?? []) {
      const crosswalk = crosswalkGeometry(zone, data.roads);
      if (crosswalk) g.add(crosswalk);
    }
    // Optional in the streamed teaching payload; no client-side scenario layout.
    for (const marker of data.teaching?.markers ?? []) g.add(teachingMarker(marker));
    for (const obj of data.objects) g.add(sceneryGeometry(obj));
    for (const agent of data.agents) g.add(sign(agent));
    for (const signal of data.teaching?.signals ?? []) {
      const light = signalGeometry();
      light.userData.objectId = signal.id;
      light.position.copy(signal.position);
      light.rotation.y = signal.yaw;
      light.userData.initialAspect = signal.initialAspect;
      setSignalAspect(light, this.signalStates.get(signal.id) ?? light.userData.initialAspect);
      this.signals.set(signal.id, light);
      g.add(light);
    }
    this.chunks.set(data.id, { data, group: g });
    this.scene.add(g);
  }
  removeChunk(id: string) {
    const old = this.chunks.get(id);
    if (old) {
      this.clearHints();
      for (const signal of old.data.teaching?.signals ?? []) this.signals.delete(signal.id);
      dispose(old.group);
      this.chunks.delete(id);
    }
  }
  snapshot(players: Player[], vehicles: Vehicle[], pedestrians: PedestrianState[] = [], signals: SignalState[] = []) {
    this.players = players;
    this.targets = vehicles;
    const ids = new Set(vehicles.map((v) => v.id));
    for (const [id, g] of this.cars)
      if (!ids.has(id)) {
        dispose(g);
        this.cars.delete(id);
      }
    for (const v of vehicles) {
      const previous = this.cars.get(v.id);
      if (previous && previous.userData.variant !== v.variant) {
        dispose(previous);
        this.cars.delete(v.id);
      }
      if (!this.cars.has(v.id)) {
        const g = vehicleGeometry(v.variant);
        g.userData.variant = v.variant;
        g.userData.objectId = v.id;
        g.position.copy(v.position);
        g.rotation.y = v.yaw;
        this.cars.set(v.id, g);
        this.scene.add(g);
      }
      // The bus is a stationary question exhibit. Apply authoritative placement
      // immediately; neither speed nor the render loop extrapolates its motion.
      if (v.variant === "bus") {
        const g = this.cars.get(v.id)!;
        g.position.copy(v.position);
        g.rotation.y = v.yaw;
      }
      this.cars.get(v.id)!.visible = v.id !== this.self?.vehicleId;
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
    const pedestrianIds = new Set(pedestrians.map(p => p.id));
    for (const [id, group] of this.pedestrians)
      if (!pedestrianIds.has(id)) {
        dispose(group);
        this.pedestrians.delete(id);
      }
    for (const p of pedestrians) {
      let group = this.pedestrians.get(p.id);
      if (!group) {
        group = pedestrianGeometry();
        group.userData.objectId = p.id;
        this.pedestrians.set(p.id, group);
        this.scene.add(group);
      }
      group.position.copy(p.position);
      group.rotation.y = p.yaw;
      group.userData.moving = p.moving;
    }
    this.signalStates = new Map(signals.map(s => [s.id, s.aspect]));
    for (const [id, group] of this.signals) setSignalAspect(group, this.signalStates.get(id) ?? group.userData.initialAspect);
    this.hints.update();
  }
  pickAgent(ndcX = 0, ndcY = 0): Agent | undefined {
    const ownCar = this.ownVehicle && this.cars.get(this.ownVehicle.id);
    return raycastAgent(this.scene, this.camera, ndcX, ndcY,
      ownCar ? [this.cockpit, ownCar] : [this.cockpit]);
  }
  pickObjectId(ndcX = 0, ndcY = 0): string | undefined {
    const ownCar = this.ownVehicle && this.cars.get(this.ownVehicle.id);
    return raycastObjectId(this.scene, this.camera, ndcX, ndcY,
      ownCar ? [this.cockpit, ownCar] : [this.cockpit]);
  }
  applyHints(hints: VisualHint[]) {
    this.hints.apply(hints, [...this.chunks.values()].map(c => c.data));
  }
  clearHints() {
    this.hints.clear();
  }
  dispose() {
    window.removeEventListener("resize", this.onResize);
    this.clearHints();
    dispose(this.scene);
    this.scene.clear();
    this.chunks.clear();
    this.cars.clear();
    this.pedestrians.clear();
    this.signals.clear();
    this.signalStates.clear();
    this.targets = [];
    this.players = [];
    this.renderer.dispose();
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
      if (v.variant === "bus") continue;
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
      const model = v && this.cars.get(v.id);
      const pos = model?.position ?? v?.position ?? self.position;
      const yaw = model?.rotation.y ?? v?.yaw ?? self.yaw;
      const offset = new T.Vector3(-0.3, 1.5, 0.25).applyAxisAngle(
        new T.Vector3(0, 1, 0),
        yaw,
      );
      this.camera.position.copy(new T.Vector3(pos.x, pos.y, pos.z).add(offset));
      // Compatibility fields lookYaw/lookPitch deliberately do not steer
      // the live camera: WASD turns the car and the camera follows its yaw.
      this.camera.rotation.set(0, yaw, 0, "YXZ");
    }
    this.hints.update();
    this.renderer.render(this.scene, this.camera);
  }
}
