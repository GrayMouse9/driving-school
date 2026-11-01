export type Id = string;
export type Vec3 = { x: number; y: number; z: number };
export type User = { id: Id; username: string };
export type Player = {
  id: Id; username: string; position: Vec3; yaw: number;
  mode: 'onFoot' | 'driving'; vehicleId: Id | null;
};
export type Vehicle = {
  id: Id; driverId: Id | null; variant: 'blue' | 'green' | 'yellow' | 'bus';
  controller: 'player' | 'npc';
  position: Vec3; yaw: number; speed: number;
};
export type Progress = {
  lessons: { lessonId: Id; status: 'available' | 'active' | 'completed'; attempts: number }[];
  learnedTopics: string[];
  mistakes: { topic: string; kind: 'answer' | 'driving'; count: number }[];
};
export type Envelope<T = any> = { v: 1; type: string; requestId?: string; payload: T };

export type WorldJoined = {
  selfId: Id; tickRate: 20; player: Player; vehicles: Vehicle[]; progress: Progress;
  episode: EpisodeState | null; activeTask: TaskStarted | null;
};
export type Snapshot = {
  tick: number; serverTime: number; ackInputSeq: number;
  players: Player[]; vehicles: Vehicle[];
  pedestrians: PedestrianState[]; signals: SignalState[];
  observers?: ObserverState[];
};
export type ActionResult = { action: 'vehicle_enter' | 'vehicle_exit' | 'chat_send' | 'episode_ready' | 'episode_leave'; ok: true };
export type ChatMessage = { senderId: Id; username: string; text: string; serverTime: number };
export type InteractionResult = {
  objectId: Id; npcId: Id | null; name: string;
  text: string; lessonIds: Id[];
};
export type NpcReply = {
  npcId: Id; name: string; text: string; topic: string | null;
  exampleId: Id | null; suggestedQuestions: string[];
  taskId: Id | null; sceneRevision: number | null;
  sources: { id: Id; pddPoints: string[] }[]; visualHints: VisualHint[];
  generation: 'local_llm';
};
export type TaskStarted = {
  lessonId: Id; taskId: Id; kind: 'choice' | 'driving'; title: string; prompt: string;
  scenarioId: Id; episodeId: Id | null; sceneRevision: number; role: 'P' | 'K';
  sourceLabel: string; helperNpcId: Id;
  options: { id: Id; text: string }[];
};
export type AnswerResult = {
  lessonId: Id; taskId: Id; correct: boolean; explanation: string;
  stage: 'choice' | 'driving'; mistakeKind: 'answer' | 'driving' | null;
  nextTaskId: Id | null;
};
export type WorldLoadStatus = { revision: number; ready: boolean };
export type ServerError = { code: string; message: string; retryable: boolean };

export type WorldMeta = {
  version: string; totalWorldBytes: number; cacheBudgetBytes: number;
  accounting: 'utf8-uncompressed-json-plus-unique-assets';
};
export type ResourceRef = { id: Id; version: string; byteLength: number };
export type ChunkRef = {
  id: Id; version: number; dataBytes: number; resources: ResourceRef[];
};
export type WorldInterest = {
  revision: number; worldVersion: string;
  chunks: ChunkRef[]; removeChunkIds: Id[]; cacheBudgetBytes: number;
};
export type Agent = {
  id: Id; kind: 'yield' | 'stop' | 'crosswalk' | 'priority'; position: Vec3; yaw: number;
  mainRoadArms?: ('north' | 'east' | 'south' | 'west')[];
};
export type Chunk = {
  id: Id; version: number; origin: {x:number;z:number}; size: number;
  objects: {
    id: Id; kind: 'building' | 'tree'; position: Vec3; yaw: number;
    size: Vec3; color: string; collidable: boolean;
  }[];
  roads: {id:Id;position:Vec3;yaw:number;width:number;length:number}[];
  agents: Agent[];
  resources: Id[];
  teaching?: {
    paths: {id:Id;points:Vec3[]}[];
    zones: {id:Id;kind:'stop'|'conflict'|'crosswalk'|'checkpoint';outline:Vec3[]}[];
    signals: {id:Id;position:Vec3;yaw:number}[];
  };
};

export type EpisodeState = {
  episodeId: Id; scenarioId: 'shared-priority'; sceneRevision: number;
  phase: 'staging' | 'answering' | 'completed' | 'paused' | 'cancelled';
  participants: {playerId:Id;role:'P'|'K';ready:boolean}[];
  selfRole: 'P' | 'K'; selfAnswerCorrect: boolean;
  activeDriver: null;
};
export type PedestrianState = {id:Id;position:Vec3;yaw:number;moving:boolean};
export type ObserverState = {id:Id;yaw:number};
export type SignalState = {id:Id;aspect:'red'|'yellow'|'green'};
export type VisualHint = {
  kind: 'highlight'; objectIds: Id[]; pathIds: Id[]; zoneIds: Id[];
  durationMs: number;
};

export type Meta = WorldMeta;
export type Input = { seq:number;throttle:number;brake:number;steer:number;moveX:number;moveZ:number;lookYaw:number };

