import type { Input } from "../types";
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
    brake: Number(keys.has("Space") || keys.has("KeyS")),
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
  const speed = Math.max(
    0,
    Math.min(
      12,
      state.speed +
        (input.throttle * 5 - input.brake * 12 - state.speed * 0.25) * dt,
    ),
  );
  const yaw = state.yaw + input.steer * speed * 0.045 * dt;
  return {
    x: state.x - Math.sin(yaw) * speed * dt,
    z: state.z - Math.cos(yaw) * speed * dt,
    yaw,
    speed,
  };
}
