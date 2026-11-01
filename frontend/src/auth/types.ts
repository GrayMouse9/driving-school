export type Vec3 = { x: number; y: number; z: number };
export type Player = {
  id: string;
  username: string;
  position: Vec3;
  yaw: number;
  mode: "onFoot" | "driving";
  vehicleId: string | null;
};
export type Vehicle = {
  id: string;
  driverId: string | null;
  variant: string;
  position: Vec3;
  yaw: number;
  speed: number;
};
export type Input = {
  seq: number;
  throttle: number;
  brake: number;
  steer: number;
  moveX: number;
  moveZ: number;
  lookYaw: number;
};
export type Agent = {
  id: string;
  kind: "yield" | "stop" | "crosswalk";
  position: Vec3;
  yaw: number;
};
export type Chunk = {
  id: string;
  version: number;
  origin: { x: number; z: number };
  size: number;
  accountedBytes: number;
  resources: unknown[];
  objects: {
    id: string;
    kind: string;
    position: Vec3;
    yaw: number;
    size: Vec3;
    color: string;
    collidable?: boolean;
  }[];
  roads: {
    id: string;
    position: Vec3;
    yaw: number;
    width: number;
    length: number;
  }[];
  agents: Agent[];
};
export type Meta = {
  version: string;
  totalWorldBytes: number;
  cacheBudgetBytes: number;
  accounting: string;
};
export type Envelope = { v: 1; type: string; requestId?: string; payload: any };
