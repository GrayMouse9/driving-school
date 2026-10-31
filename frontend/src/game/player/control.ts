import type {Input} from "./types";
export function readInput(
  keys: Set<string>,
  lookYaw: number,
  seq: number,
): Input {
  const forward = keys.has("KeyW") || keys.has("ArrowUp");
  const backward = keys.has("KeyS") || keys.has("ArrowDown");
  const left = keys.has("KeyA") || keys.has("ArrowLeft");
  const right = keys.has("KeyD") || keys.has("ArrowRight");
  return {
    seq,
    throttle: Number(forward && !backward),
    brake: Number(backward),
    steer: Number(left) - Number(right),
    moveX: Number(right) - Number(left),
    moveZ: Number(backward) - Number(forward),
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
