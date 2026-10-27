import type { RoomAssemblyState, RoomCommand } from '@daisy/protocol';
import { executeRoomCommand } from './room-assembly';
import { consent, edges, state } from './room-assembly.test-support';
import { bytesOf } from './draw-random';

export const SEED = '01'.repeat(32);
export const SALT = '02'.repeat(32);
export const SENTINEL = 'SENTINEL-RESOLUTION';
export const hostList = [1, 2, 3, 4, 5].map((n) => `${SENTINEL}-${n}`);

export const drawConfig = {
  enabled: true as const,
  drawSize: 5,
  strikeWindowMs: 60_000,
  firstStriker: 'negative' as const,
};

/** A casual One-on-one-like Room whose host list draws 5. */
export const drawRoom = (
  source:
    | { kind: 'host'; resolutions: string[] }
    | { kind: 'bank'; categories: ('policy' | 'value' | 'fact')[] } = {
    kind: 'host',
    resolutions: hostList,
  },
): RoomAssemblyState => {
  const base = state();
  const resolutionDraw = { ...drawConfig, source };
  return {
    ...base,
    topic: null,
    definition: {
      ...base.definition,
      configurable: {
        ...base.definition.configurable,
        resolutionDraw: {
          drawSize: { min: 3, max: 7 },
          strikeWindowMs: { min: 15_000, max: 180_000 },
          firstStrikers: ['negative', 'affirmative'],
          sources: ['bank', 'host'],
        },
      },
    },
    config: { ...base.config, resolutionDraw },
    executionPlan: { ...base.executionPlan, resolutionDraw },
  };
};

export const drawStart = {
  drawId: 'draw00000000000000000001',
  seed: SEED,
  salt: SALT,
  bank: null,
  exclusions: [],
};
export const seed = SEED;
export const seedBytes = bytesOf(SEED);
export const at = (seconds: number) =>
  new Date(Date.parse(edges.now) + seconds * 1000).toISOString();
export const command = (
  type: RoomCommand['type'],
  extra: Record<string, unknown> = {},
  room: RoomAssemblyState,
) =>
  ({
    type,
    commandId: `${type}-${extra.ordinal ?? 0}`,
    expectedVersion: room.version,
    ...extra,
  }) as RoomCommand;

export const begin = (room = drawRoom()) => {
  const outcome = executeRoomCommand(
    room,
    'host',
    command('start-pre-round', {}, room),
    consent,
    { ...edges, drawStart },
  );
  if (!outcome.ok) throw new Error(outcome.refusal);
  return outcome.mutation;
};

export const strike = (
  room: RoomAssemblyState,
  actorId: string,
  ordinal: number,
  position: number,
  now = edges.now,
) =>
  executeRoomCommand(
    room,
    actorId,
    command('strike-resolution', { ordinal, position }, room),
    consent,
    { ...edges, now, drawSeed: seed },
  );
