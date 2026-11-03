import {
  drawCapableBounds,
  plainFormatSettings,
} from '@daisy/protocol/testing';
import type {
  FormatSettings,
  RoomAssemblyState,
  RoomCommand,
} from '@daisy/protocol';
import { executeRoomCommand } from './room-assembly';
import { consent, edges, state } from './room-assembly.test-support';
import { bytesOf } from './draw-random';
import {
  settleOpening,
  strikeOpening,
  type OpeningSeat,
} from './round-opening';

export const SEED = '01'.repeat(32);
export const SALT = '02'.repeat(32);
export const SENTINEL = 'SENTINEL-RESOLUTION';
const hostList = [1, 2, 3, 4, 5].map((n) => `${SENTINEL}-${n}`);

const drawConfig = {
  enabled: true as const,
  drawSize: 5,
  strikeWindowMs: 60_000,
  firstStriker: 'negative' as const,
};

type BankCategories = ('policy' | 'value' | 'fact')[];

/** The format settings of a bank strike drawing 5: what a strike preset holds. */
export const drawSettings = (categories: BankCategories): FormatSettings => ({
  ...plainFormatSettings,
  resolutionDraw: { ...drawConfig, source: { kind: 'bank', categories } },
});

/** A casual One-on-one-like Room whose host list draws 5. */
export const drawRoom = (
  source:
    | { kind: 'host'; resolutions: string[] }
    | { kind: 'bank'; categories: BankCategories } = {
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
        resolutionDraw: drawCapableBounds,
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

/** The Start round of a draw Room: its mutation, draw and secrets included. */
export const begin = (room = drawRoom(), ready = consent) => {
  const outcome = executeRoomCommand(
    room,
    'host',
    command('start-round', {}, room),
    ready,
    { ...edges, drawStart },
  );
  if (!outcome.ok) throw new Error(outcome.refusal);
  return outcome.mutation;
};

const seatsOf = (room: RoomAssemblyState): readonly OpeningSeat[] =>
  room.participants;

/** The opening a Start round leaves, with its seats. */
export const opened = (room = drawRoom(), prepMs: number | null = null) => {
  const draw = begin(room).draw;
  return {
    seats: seatsOf(room),
    opening: { startRoundAt: edges.now, draw: draw?.state ?? null, prepMs },
  };
};

/** A debater's strike on the opening settled at `now`. */
export const strike = (
  { opening, seats }: ReturnType<typeof opened>,
  actorId: string,
  ordinal: number,
  position: number,
  now = edges.now,
) =>
  strikeOpening(settleOpening(opening, seedBytes, now).opening, seats, {
    actorId,
    commandId: `strike-${ordinal}`,
    ordinal,
    position,
    now,
  });
