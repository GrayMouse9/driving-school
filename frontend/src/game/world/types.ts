import type { Agent, Vec3 } from '../entities/types';
export type Chunk = {
    id: string;
    version: number;
    origin: {
        x: number;
        z: number;
    };
    size: number;
    accountedBytes?: number;
    resources: unknown[];
    teaching?: {
        paths: {
            id: string;
            points: Vec3[];
        }[];
        zones: {
            id: string;
            kind: 'stop' | 'conflict' | 'crosswalk' | 'checkpoint';
            outline: Vec3[];
        }[];
        signals: {
            id: string;
            position: Vec3;
            yaw: number;
            initialAspect?: 'red' | 'yellow' | 'green';
        }[];
        markers?: {
            id: string;
            label: string;
            position: Vec3;
        }[];
    };
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
