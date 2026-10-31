// Preserve absolute viewing direction when entering/exiting a rotated vehicle.
export function rebaseLookYaw(
  lookYaw: number,
  previousBase: number,
  nextBase: number,
) {
  return lookYaw + previousBase - nextBase;
}
