import { z } from 'zod';

export const dreamerStatusSchema = z.enum(['resting', 'waking', 'error']);
export const worldEventKindSchema = z.enum([
  'origin',
  'seed',
  'wake',
  'post',
  'message',
  'belief',
  'rest',
  'reflection',
  'error',
]);

export type DreamerStatus = z.infer<typeof dreamerStatusSchema>;
export type WorldEventKind = z.infer<typeof worldEventKindSchema>;
export type WorldEventMetadata = Record<string, unknown>;

export type Dreamer = {
  id: string;
  worldId: string;
  sortOrder: number;
  name: string;
  archetype: string;
  sigil: string;
  color: string;
  purpose: string;
  persona: string;
  conversationId: string;
  status: DreamerStatus;
  wakeCount: number;
  lastSeenSequence: number;
  lastAwakeAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type DreamerView = Omit<Dreamer, 'persona' | 'conversationId' | 'lastSeenSequence'> & {
  unreadCount: number;
};

export type WorldEvent = {
  sequence: number;
  id: string;
  worldId: string;
  tick: number;
  kind: WorldEventKind;
  actorDreamerId?: string;
  targetDreamerId?: string;
  parentSequence?: number;
  title: string;
  content: string;
  metadata: WorldEventMetadata;
  createdAt: string;
};

export type WorldState = {
  id: string;
  generation: string;
  currentTick: number;
  nextDreamerIndex: number;
  createdAt: string;
  updatedAt: string;
};

export type WakeContext = {
  dreamer: Dreamer;
  tick: number;
  visibleEvents: WorldEvent[];
  horizonSequence: number;
};

export type ActiveCycleView = {
  id: string;
  requestedSteps: number;
  completedSteps: number;
  startedAt: string;
  dreamerId?: string;
  dreamerName?: string;
  runId?: string;
  latestActivity: string;
  cancelRequested: boolean;
};

export type TerrariumSnapshot = {
  world: WorldState;
  dreamers: DreamerView[];
  events: WorldEvent[];
  activeCycle?: ActiveCycleView;
  runtime: {
    model: string;
    heddleVersion: string;
  };
};

export type MindActivity = {
  type: string;
  summary: string;
  timestamp: string;
};

export type DreamerMindResult = {
  outcome: string;
  summary: string;
  traceFile?: string;
  toolCount: number;
};

export type DreamerMindRun = {
  runId: string;
  result: Promise<DreamerMindResult>;
  cancel(): boolean;
};

export type StartDreamerMindInput = {
  dreamer: Dreamer;
  tick: number;
  visibleEvents: WorldEvent[];
  signal: AbortSignal;
  onActivity?(activity: MindActivity): void;
};

export interface DreamerMind {
  start(input: StartDreamerMindInput): Promise<DreamerMindRun>;
}
