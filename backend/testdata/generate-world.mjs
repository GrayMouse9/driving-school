import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Development geometry only; not the teaching scenarios or validated road rules.
const chunks = [];
for (let gx = -5; gx < 5; gx++) {
  for (let gz = -5; gz < 5; gz++) {
    const x = gx * 64, z = gz * 64;
    const objects = [];
    for (const ox of [12, 52]) for (const oz of [12, 52]) {
      objects.push({ id: `house_${gx}_${gz}_${ox}_${oz}`, kind: "building", position: { x: x + ox, y: 0, z: z + oz }, yaw: 0, size: { x: 12, y: 8, z: 12 }, color: "#d9cfbc", collidable: true });
    }
    chunks.push({
      id: `c_${gx}_${gz}`, version: 1, origin: { x, z }, size: 64,
      objects,
      roads: [
        { id: `road_ns_${gx}_${gz}`, position: { x: x + 32, y: 0, z: z + 32 }, yaw: 0, width: 12, length: 64 },
        { id: `road_ew_${gx}_${gz}`, position: { x: x + 32, y: 0, z: z + 32 }, yaw: Math.PI / 2, width: 12, length: 64 },
      ],
      agents: [], resources: [],
    });
  }
}
const world = {
  version: "development-v1",
  spawnPoints: [
    { x: 27, y: 0, z: 32, yaw: 0 },
    { x: 32, y: 0, z: 32, yaw: 0 },
    { x: 37, y: 0, z: 32, yaw: 0 },
  ],
  chunks,
};
writeFileSync(fileURLToPath(new URL("development-world.json", import.meta.url)), JSON.stringify(world));
