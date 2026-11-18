import type {
  OpenRoomStatus,
  RoomAssemblyState,
  RoundStatus,
} from '@daisy/protocol';
import { plainRoomConfig } from '@daisy/protocol/testing';
import { sideSeat, twoSides } from '@daisy/protocol';
const rules = {
  version: 3 as const,
  sides: [...twoSides],
  seats: {
    sides: { affirmative: 1, negative: 1 },
    speakers: 0,
    judges: 0,
    moderators: 0 as const,
  },
  outcome: { kind: 'winner' as const },
  segments: [
    {
      key: 'A1',
      label: 'Affirmative speech',
      type: 'speech' as const,
      speak: { rights: 'one' as const, seat: sideSeat('affirmative') },
      durationMs: 60_000,
    },
    {
      key: 'N1',
      label: 'Negative speech',
      type: 'speech' as const,
      speak: { rights: 'one' as const, seat: sideSeat('negative') },
      durationMs: 60_000,
    },
  ],
  inRoundPrep: null,
  countdownMs: 0,
  interaction: {
    yield: null,
    interruptions: { allowed: 'disabled' as const },
  },
};
/** A Room still gathering its players: it has launched no Round. */
type OpenRoom = Extract<RoomAssemblyState, { readonly roundRef: null }> & {
  readonly status: OpenRoomStatus;
};
/** That Room once started: a started Room always names its Round. */
export const started = (
  room: RoomAssemblyState,
  status: RoundStatus = 'active',
): RoomAssemblyState => ({
  ...room,
  status: 'started',
  roundRef: { id: 'round', status },
});
export const state = (): OpenRoom => ({
  id: 'room',
  version: 4,
  changeVersion: 1,
  title: 'Room',
  topic: 'Motion',
  visibility: 'public',
  hostActorId: 'host',
  hostInherited: false,
  hostLabel: 'Host',
  seatHolds: [],
  teamOneSide: 'affirmative',
  status: 'ready',
  formatId: 'format',
  formatVersion: 1,
  presetVersion: null,
  catalogFormat: { name: 'Custom format', role: null, leagues: [] },
  basis: null,
  competitionType: 'casual',
  definition: {
    version: 2,
    sides: rules.sides,
    seats: rules.seats,
    outcome: rules.outcome,
    segments: rules.segments.map(({ durationMs, ...segment }) => ({
      ...segment,
      defaultDurationMs: durationMs,
    })),
    configurable: {
      preRoundPrep: null,
      resolutionDraw: null,
      inRoundPrep: null,
      timing: {
        countdownMs: { min: 0, max: 0 },
        segmentDurationMs: {
          A1: { min: 60_000, max: 60_000 },
          N1: { min: 60_000, max: 60_000 },
        },
      },
      interaction: {
        interruptions: null,
        yield: null,
      },
    },
  },
  config: plainRoomConfig,
  capture: null,
  postRoundCall: false,
  executionPlan: {
    preRoundPrep: { enabled: false },
    resolutionDraw: { enabled: false },
  },
  rules,
  participants: [
    {
      id: 'p1',
      actorId: 'host',
      label: 'Host',
      kind: 'human',
      seat: sideSeat('affirmative'),
      teamOpen: false,
      positionOpen: false,
      eligible: true,
      consentVersion: 0,
      consentCommandId: 'r1',
    },
    {
      id: 'p2',
      actorId: 'other',
      label: 'Other',
      kind: 'human',
      seat: sideSeat('negative'),
      teamOpen: false,
      positionOpen: false,
      eligible: true,
      consentVersion: 0,
      consentCommandId: 'r2',
    },
  ],
  roundRef: null,
});
export const edges = {
  now: '2026-10-09T00:00:00.000Z',
  participantId: 'new-seat',
  roundId: 'new-round',
  formatId: 'new-format',
  target: null,
  hostMaySeatCasualAiJudge: true,
  hostHoldsCasualCapture: true,
  drawStart: null,
  seatSeed: '00'.repeat(32),
};
export const consent = { available: true, readyActorIds: ['host', 'other'] };
