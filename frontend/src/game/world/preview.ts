import type {Chunk} from "./types";
import type {Player, Vehicle} from "../entities/types";
// One small fixture, never a substitute for the server city or network test.
export function previewChunk(): Chunk {
  return {
    id: "preview",
    version: 1,
    origin: { x: -32, z: -48 },
    size: 64,
    accountedBytes: 0,
    resources: [],
    roads: [
      {
        id: "road",
        position: { x: 0, y: 0, z: -16 },
        yaw: 0,
        width: 10,
        length: 64,
      },
    ],
    objects: [
      ...[-1, 1].flatMap((side) =>
        [0, 1, 2, 3].map((i) => ({
          id: `house-${side}-${i}`,
          kind: "building",
          position: { x: side * 17, y: 0, z: 8 - i * 16 },
          yaw: 0,
          size: { x: 9, y: 6 + (i % 2) * 3, z: 10 },
          color: ["#ead6b4", "#f0e3c5", "#e4bfa5", "#c9d9be"][i],
        })),
      ),
      ...[-1, 1].flatMap((side) =>
        [0, 1, 2, 3, 4].map((i) => ({
          id: `tree-${side}-${i}`,
          kind: "tree",
          position: { x: side * 8, y: 0, z: 10 - i * 12 },
          yaw: 0,
          size: { x: 1.8, y: 5, z: 1.8 },
          color: "#78a965",
        })),
      ),
    ],
    agents: [
      {
        id: "preview-priority",
        kind: "priority",
        position: { x: 5.5, y: 0, z: 4 },
        yaw: 0,
        mainRoadArms: ["south", "west"],
      },
      {
        id: "preview-yield",
        kind: "yield",
        position: { x: 6, y: 0, z: -8 },
        yaw: 0,
      },
      {
        id: "preview-stop",
        kind: "stop",
        position: { x: 6, y: 0, z: -25 },
        yaw: 0,
      },
      {
        id: "preview-crosswalk",
        kind: "crosswalk",
        position: { x: -6, y: 0, z: -15 },
        yaw: 0,
      },
    ],
  };
}
export function previewState(): { players: Player[]; vehicles: Vehicle[] } {
  return {
    players: [
      {
        id: "preview-self",
        username: "Вы · тест",
        position: { x: 2.5, y: 0, z: 8 },
        yaw: 0,
        mode: "driving",
        vehicleId: "preview-blue",
      },
    ],
    vehicles: [
      {
        id: "preview-bus",
        driverId: null,
        variant: "bus",
        controller: "npc",
        position: { x: -2.5, y: 0, z: -25 },
        yaw: 0,
        speed: 0,
      },
      {
        id: "preview-blue",
        driverId: "preview-self",
        variant: "blue",
        position: { x: 2.5, y: 0, z: 8 },
        yaw: 0,
        speed: 0,
      },
      {
        id: "preview-green",
        driverId: null,
        variant: "green",
        position: { x: -2.5, y: 0, z: -8 },
        yaw: 0,
        speed: 0,
      },
      {
        id: "preview-yellow",
        driverId: null,
        variant: "yellow",
        position: { x: 2.5, y: 0, z: -20 },
        yaw: 0,
        speed: 0,
      },
    ],
  };
}
