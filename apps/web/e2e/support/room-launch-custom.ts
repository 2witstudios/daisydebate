import {
  affirmativeSide,
  negativeSide,
  sideSeat,
  twoSides,
} from '@daisy/protocol/seats';
import { formatDefinitionSchema } from '@daisy/protocol/format';
import { roomConfigSchema } from '@daisy/protocol/room';
import { type RoomCreate } from '@daisy/protocol/room-contract';
import { plainRoomConfig } from '@daisy/protocol/testing';
/** Declared proof format, persisted through canonical custom-create, never a mock view. */
export const launchCustomSelection = {
  kind: 'custom' as const,
  competitionType: 'casual' as const,
  definition: formatDefinitionSchema.parse({
    version: 2,
    sides: twoSides,
    seats: {
      sides: { [affirmativeSide]: 2, [negativeSide]: 1 },
      speakers: 0,
      judges: 1,
      moderators: 0,
    },
    outcome: { kind: 'winner' },
    segments: [
      {
        key: 'N1',
        label:
          'Negative opening with a detailed motion and an extended explanation of its scope',
        type: 'speech',
        speak: { rights: 'one', seat: sideSeat(negativeSide) },
        defaultDurationMs: 41000,
      },
      {
        key: 'A2',
        label: 'Second affirmative',
        type: 'speech',
        speak: { rights: 'one', seat: sideSeat(affirmativeSide, 1) },
        defaultDurationMs: 53000,
      },
      {
        key: 'A1',
        label: 'First affirmative closing',
        type: 'speech',
        speak: { rights: 'one', seat: sideSeat(affirmativeSide) },
        defaultDurationMs: 47000,
      },
    ],
    configurable: {
      timing: {
        segmentDurationMs: {
          // Every speech covers the 40 s attendance grace (resolveRoomConfiguration).
          N1: { min: 40000, max: 60000 },
          A2: { min: 40000, max: 60000 },
          A1: { min: 40000, max: 60000 },
        },
        countdownMs: { min: 0, max: 5000 },
      },
      preRoundPrep: null,
      resolutionDraw: null,
      inRoundPrep: null,
      interaction: {
        interruptions: null,
        yield: null,
      },
    },
  }),
  config: roomConfigSchema.parse(plainRoomConfig),
} satisfies Extract<RoomCreate['selection'], { kind: 'custom' }>;
