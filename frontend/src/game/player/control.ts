import type {Input} from "./types";
export function readInput(
  keys: Set<string>,
  lookYaw: number,
  seq: number,
): Input {
  const axis = (positive: string, negative: string) =>
    Number(keys.has(positive)) - Number(keys.has(negative));
  return {
    seq,
    throttle: Number(keys.has("KeyW") && !keys.has("KeyS")),
    brake: Number(keys.has("KeyS")),
    steer: axis("KeyA", "KeyD"),
    moveX: axis("KeyD", "KeyA"),
    moveZ: axis("KeyS", "KeyW"),
    lookYaw,
  };
}
// Only the explicitly selected preview uses this local motion. Production renders server state.
export function stepPreview(
  state: { x: number; z: number; yaw: number; speed: number },
  input: Input,
  delta: number,
) {
  const dt = Math.min(0.1, Math.max(0, delta));
  let speed = state.speed;
  if(input.throttle>0 && input.brake===0) speed=speed<0?Math.min(0,speed+8*dt):Math.min(12,speed+4*input.throttle*dt);
  else if(input.brake>0) speed=speed>0?Math.max(0,speed-8*input.brake*dt):Math.max(-3,speed-4*input.brake*dt);
  else speed=speed>0?Math.max(0,speed-8*dt):Math.min(0,speed+8*dt);
  const yaw = state.yaw + input.steer * Math.sign(speed)*Math.min(Math.abs(speed)/4,1)*.8*dt;
  return {
    x: state.x - Math.sin(yaw) * speed * dt,
    z: state.z - Math.cos(yaw) * speed * dt,
    yaw,
    speed,
  };
}
