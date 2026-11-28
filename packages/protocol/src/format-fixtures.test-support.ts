import type { FormatDefinition } from './format';
import type { FormatSettings } from './format-settings';
import type { RoomConfig } from './room';
import { sideSeat, twoSides, type SeatRef } from './seats';

/** A speech by one seat. */
const speech = (seat: SeatRef) => ({ rights: 'one' as const, seat });
/** Cross-examination: every debater speaks, `asker` leads. */
const crossEx = (asker: SeatRef) => ({ rights: 'all' as const, lead: asker });

/** Format settings with no prep, timing overrides, points of information or yielding. */
export const plainFormatSettings: FormatSettings = {
  preRoundPrep: { enabled: false },
  resolutionDraw: { enabled: false },
  inRoundPrep: { enabled: false },
  speechTiming: { countdownMs: 0, segmentDurationOverrides: {} },
  pointsOfInformation: null,
  yielding: null,
};

/** A room config with no prep, timing overrides, points of information or yielding. */
export const plainRoomConfig: RoomConfig = { ...plainFormatSettings };

/**
 * One-on-one's casual format settings, shared by the engine's tests and
 * pinned to `@daisy/db`'s reference value by its test (ISSUE-775).
 */
export const oneOnOneSettingsFixture: FormatSettings = {
  preRoundPrep: { enabled: false },
  resolutionDraw: { enabled: false },
  inRoundPrep: { enabled: true, budgetMsPerSide: 240_000 },
  speechTiming: {
    countdownMs: 10_000,
    segmentDurationOverrides: {},
  },
  pointsOfInformation: { enabled: false },
  yielding: { allowed: true, returnsTime: true },
};

/** Shared one-on-one format fixture for protocol and engine contract tests. */
export const oneOnOneFormatFixture: FormatDefinition = {
  version: 2,
  sides: [...twoSides],
  seats: {
    sides: { affirmative: 1, negative: 1 },
    speakers: 0,
    judges: 1,
    moderators: 0,
  },
  outcome: { kind: 'winner' },
  segments: [
    {
      key: 'AC',
      label: 'Affirmative constructive',
      type: 'speech',
      speak: speech(sideSeat('affirmative')),
      defaultDurationMs: 300_000,
    },
    {
      key: 'CX1',
      label: 'Cross-examination of the affirmative',
      type: 'cross_ex',
      speak: crossEx(sideSeat('negative')),
      defaultDurationMs: 120_000,
    },
    {
      key: 'NC',
      label: 'Negative constructive',
      type: 'speech',
      speak: speech(sideSeat('negative')),
      defaultDurationMs: 360_000,
    },
    {
      key: 'CX2',
      label: 'Cross-examination of the negative',
      type: 'cross_ex',
      speak: crossEx(sideSeat('affirmative')),
      defaultDurationMs: 120_000,
    },
    {
      key: '1AR',
      label: 'First affirmative rebuttal',
      type: 'speech',
      speak: speech(sideSeat('affirmative')),
      defaultDurationMs: 300_000,
    },
    {
      key: 'NR',
      label: 'Negative rebuttal',
      type: 'speech',
      speak: speech(sideSeat('negative')),
      defaultDurationMs: 300_000,
    },
    {
      key: '2AR',
      label: 'Second affirmative rebuttal',
      type: 'speech',
      speak: speech(sideSeat('affirmative')),
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
    resolutionDraw: null,
    interaction: {
      pointsOfInformation: {
        protectedStartMs: { min: 0, max: 120_000 },
        protectedEndMs: { min: 0, max: 120_000 },
        maxDurationMs: { min: 5_000, max: 30_000 },
        offerLapseMs: { min: 5_000, max: 30_000 },
      },
      yield: {
        enabledChoices: [true, false],
        returnsTimeChoices: [true, false],
      },
    },
  },
};

export const invalidFormatDefinitions: ReadonlyArray<
  readonly [string, FormatDefinition]
> = [
  [
    'unseated speaker',
    {
      ...oneOnOneFormatFixture,
      segments: oneOnOneFormatFixture.segments.map((segment, index) =>
        index === 0
          ? { ...segment, speak: speech(sideSeat('affirmative', 99)) }
          : segment,
      ),
    },
  ],
  [
    'default outside timing bounds',
    {
      ...oneOnOneFormatFixture,
      segments: oneOnOneFormatFixture.segments.map((segment, index) =>
        index === 0 ? { ...segment, defaultDurationMs: 1 } : segment,
      ),
    },
  ],
  [
    'inverted bounds',
    {
      ...oneOnOneFormatFixture,
      configurable: {
        ...oneOnOneFormatFixture.configurable,
        timing: {
          ...oneOnOneFormatFixture.configurable.timing,
          countdownMs: { min: 10, max: 1 },
        },
      },
    },
  ],
  [
    'dangling disabled prep reference',
    {
      ...oneOnOneFormatFixture,
      configurable: {
        ...oneOnOneFormatFixture.configurable,
        inRoundPrep: {
          budgetMsPerSide: { min: 0, max: 600_000 },
          spendableBefore: ['speech'],
          expiresAtSegment: 'MISSING',
        },
      },
    },
  ],
];

/** Audit fixtures keep timing keys consistent so each refusal isolates its invariant. */
function onlySideSegments(
  definition: FormatDefinition,
  side: 'affirmative' | 'negative',
): FormatDefinition {
  const segments = definition.segments.filter(
    (s) =>
      s.speak.rights === 'one' &&
      s.speak.seat.kind === 'side' &&
      s.speak.seat.side === side,
  );
  return {
    ...definition,
    segments,
    configurable: {
      ...definition.configurable,
      timing: {
        ...definition.configurable.timing,
        segmentDurationMs: Object.fromEntries(
          segments.map((s) => [
            s.key,
            definition.configurable.timing.segmentDurationMs[s.key]!,
          ]),
        ),
      },
    },
  };
}

const withSeats = (
  seats: Partial<FormatDefinition['seats']>,
  definition: FormatDefinition = oneOnOneFormatFixture,
): FormatDefinition => ({
  ...definition,
  seats: { ...oneOnOneFormatFixture.seats, ...seats },
});

export const unsafeFormatDefinitions: ReadonlyArray<
  readonly [string, FormatDefinition]
> = [
  ...(['affirmative', 'negative'] as const).map(
    (side) =>
      [
        `billion ${side} seats`,
        withSeats({
          sides: {
            ...oneOnOneFormatFixture.seats.sides,
            [side]: 1_000_000_000,
          },
        }),
      ] as const,
  ),
  ['billion judge seats', withSeats({ judges: 1_000_000_000 })],
  [
    'over total with individually bounded seats',
    withSeats({ sides: { affirmative: 128, negative: 128 }, judges: 1 }),
  ],
  [
    'no negative seats',
    withSeats(
      { sides: { affirmative: 1, negative: 0 }, judges: 0 },
      onlySideSegments(oneOnOneFormatFixture, 'affirmative'),
    ),
  ],
  [
    'negative seats without speaking opportunity',
    onlySideSegments(oneOnOneFormatFixture, 'affirmative'),
  ],
  ...(['affirmative', 'negative'] as const).map(
    (side) =>
      [
        `one over the seat work bound: ${side}`,
        withSeats({
          sides: { ...oneOnOneFormatFixture.seats.sides, [side]: 257 },
        }),
      ] as const,
  ),
  ['one over the seat work bound: judges', withSeats({ judges: 257 })],
  [
    'no affirmative seats',
    withSeats(
      { sides: { affirmative: 0, negative: 1 }, judges: 0 },
      onlySideSegments(oneOnOneFormatFixture, 'negative'),
    ),
  ],
  [
    'affirmative seats without speaking opportunity',
    onlySideSegments(oneOnOneFormatFixture, 'negative'),
  ],
  ['missing negative count', withSeats({ sides: { affirmative: 1 } })],
];

/** Rules resolved from a definition at its default timing. */
export const fixtureRules = (definition: FormatDefinition) => ({
  version: 3 as const,
  sides: definition.sides,
  seats: definition.seats,
  outcome: definition.outcome,
  segments: definition.segments.map(({ defaultDurationMs, ...s }) => ({
    ...s,
    durationMs: defaultDurationMs,
  })),
  inRoundPrep: null,
  countdownMs: 0,
  interaction: {
    yield: null,
    pointsOfInformation: { allowed: false as const },
  },
});

/** Draw bounds a draw-capable format fixture declares (FMT-7). */
export const drawCapableBounds: NonNullable<
  FormatDefinition['configurable']['resolutionDraw']
> = {
  drawSize: { min: 3, max: 7 },
  strikeWindowMs: { min: 15_000, max: 180_000 },
  firstStrikers: ['negative', 'affirmative'],
  sources: ['bank', 'host'],
};
