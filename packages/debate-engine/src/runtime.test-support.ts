import type {
  FormatDefinition,
  RoomConfig,
  RoundParticipantSeat,
  RoundRules,
} from '@daisy/protocol';
import { createRoundRuntime } from './round-runtime';
import { resolveRoomConfiguration } from './resolve-room-configuration';

/**
 * The one-on-one practice format as a definition, and the room config the
 * AI-practice rooms resolve from. The seven-segment schedule and the prep
 * and countdown constants the engine used to hardcode are data here.
 */
export const oneOnOneDefinition: FormatDefinition = {
  version: 1,
  seats: { affirmative: 1, negative: 1, judge: 1 },
  segments: [
    {
      key: 'AC',
      label: 'Affirmative constructive',
      type: 'speech',
      side: 'affirmative',
      slot: 0,
      defaultDurationMs: 300_000,
    },
    {
      key: 'CX1',
      label: 'Cross-examination of the affirmative',
      type: 'cross_ex',
      side: 'negative',
      slot: 0,
      defaultDurationMs: 120_000,
    },
    {
      key: 'NC',
      label: 'Negative constructive',
      type: 'speech',
      side: 'negative',
      slot: 0,
      defaultDurationMs: 360_000,
    },
    {
      key: 'CX2',
      label: 'Cross-examination of the negative',
      type: 'cross_ex',
      side: 'affirmative',
      slot: 0,
      defaultDurationMs: 120_000,
    },
    {
      key: '1AR',
      label: 'First affirmative rebuttal',
      type: 'speech',
      side: 'affirmative',
      slot: 0,
      defaultDurationMs: 300_000,
    },
    {
      key: 'NR',
      label: 'Negative rebuttal',
      type: 'speech',
      side: 'negative',
      slot: 0,
      defaultDurationMs: 300_000,
    },
    {
      key: '2AR',
      label: 'Second affirmative rebuttal',
      type: 'speech',
      side: 'affirmative',
      slot: 0,
      defaultDurationMs: 180_000,
    },
  ],
  configurable: {
    timing: {
      segmentDurationMs: {
        AC: { min: 60_000, max: 600_000 },
        CX1: { min: 30_000, max: 300_000 },
        NC: { min: 60_000, max: 600_000 },
        CX2: { min: 30_000, max: 300_000 },
        '1AR': { min: 60_000, max: 600_000 },
        NR: { min: 60_000, max: 600_000 },
        '2AR': { min: 30_000, max: 600_000 },
      },
      countdownMs: { min: 0, max: 60_000 },
    },
    inRoundPrep: {
      budgetMsPerSide: { min: 0, max: 600_000 },
      spendableBefore: ['speech'],
      expiresAtSegment: null,
    },
    preRoundPrep: { durationMs: { min: 0, max: 1_200_000 } },
    interaction: {
      crossExModes: ['ordered', 'free'],
      interruptions: {
        modes: ['disabled', 'cross_ex_only', 'enabled'],
        minRemainingMs: { min: 0, max: 300_000 },
      },
      yield: {
        enabledChoices: [true, false],
        returnsTimeChoices: [true, false],
      },
    },
  },
};

export const practiceConfig: RoomConfig = {
  preRoundPrep: { enabled: false },
  inRoundPrep: { enabled: true, budgetMsPerSide: 240_000 },
  speechTiming: {
    countdownMs: 10_000,
    segmentDurationOverrides: {},
  },
  crossExamination: { crossExMode: 'ordered' },
  interruptions: { mode: 'cross_ex_only', minRemainingMs: 30_000 },
  yielding: { allowed: true, returnsTime: true },
};

/** The resolved rules for the practice room; throws when it refuses. */
export const practiceRules = (): RoundRules => {
  const outcome = resolveRoomConfiguration(oneOnOneDefinition, practiceConfig);
  if (!outcome.ok) throw new Error(outcome.refusal.message);
  return outcome.rules;
};

/** Sequential segment ids, so projections are deterministic in tests. */
export const sequentialSegmentIds = (): (() => string) => {
  let next = 0;
  return () => {
    next += 1;
    return `segment-${next}`;
  };
};

/** The instant the runtime tests' clock starts from. */
const t0 = '2026-10-06T09:00:00.000Z';

/** An ISO instant `ms` after the tests' clock start. */
export const roundAt = (ms: number): string =>
  new Date(Date.parse(t0) + ms).toISOString();

const affirmativeActor = 'k2v9x0f4m8q3w1z7c5n6b4d2';
const negativeActor = 'a7b3c9d1e5f2k4m6n8p1r3t5';
const judgeActor = 'c8d4e2f6a1b3k5m7n9p2r4t6';

/** The practice round's three seated actors: both sides and the judge. */
export const practiceActors = {
  affirmative: affirmativeActor,
  negative: negativeActor,
  judge: judgeActor,
} as const;

/** The seats those actors hold, in slot order. */
export const practiceSeats = [
  {
    id: 'm3w8k1z5c9b2n7p4r6t0v2x4',
    actorId: affirmativeActor,
    role: 'affirmative',
    slot: 0,
  },
  {
    id: 'q5x2v8t0r4p6n2b8c1z7k3m9w',
    actorId: negativeActor,
    role: 'negative',
    slot: 0,
  },
  {
    id: 'd6y3h9j1f5a7s3g8l2q6e4u0i',
    actorId: judgeActor,
    role: 'judge',
    slot: 0,
  },
] as const;

/** The empty checkpoint a fresh round hydrates from. */
export const emptyCheckpoint = {
  version: 1,
  prep_consumed_ms: { affirmative: 0, negative: 0 },
  active_prep: null,
  floor: null,
} as const;

/** Options `runtimeWorld` takes; every field defaults to a fresh round. */
export type RuntimeWorldOptions = {
  readonly status?: 'scheduled' | 'active' | 'completed' | 'abandoned';
  readonly segments?: Parameters<typeof createRoundRuntime>[0]['segments'];
  readonly checkpoint?: unknown;
  readonly rules?: RoundRules;
  readonly participants?: readonly RoundParticipantSeat[];
};

/** A runtime over the practice format, as the runtime tests execute it. */
export const runtimeWorld = ({
  status = 'scheduled',
  segments = [],
  checkpoint = emptyCheckpoint,
  rules = practiceRules(),
  participants = practiceSeats,
}: RuntimeWorldOptions = {}) =>
  createRoundRuntime({
    round: {
      id: 'round-1',
      status,
      currentStage: null,
      startedAt: null,
      completedAt: null,
      outcome: null,
    },
    rules,
    participants: [...participants],
    checkpoint,
    segments,
    nextSegmentId: sequentialSegmentIds(),
  });
