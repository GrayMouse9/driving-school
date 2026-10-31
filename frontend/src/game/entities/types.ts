export type Vec3 = {
    x: number;
    y: number;
    z: number;
};
export type Player = {
    id: string;
    username: string;
    position: Vec3;
    yaw: number;
    mode: 'onFoot' | 'driving';
    vehicleId: string | null;
};
export type Vehicle = {
    id: string;
    driverId: string | null;
    variant: string;
    position: Vec3;
    yaw: number;
    speed: number;
    controller?: 'player' | 'npc';
};
export type Agent = {
    id: string;
    kind: 'yield' | 'stop' | 'crosswalk' | 'priority';
    position: Vec3;
    yaw: number;
    mainRoadArms?: ('north' | 'east' | 'south' | 'west')[];
};
