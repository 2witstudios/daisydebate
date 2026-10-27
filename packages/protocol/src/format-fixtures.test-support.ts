import type { FormatDefinition, RoomConfig } from './index';

/** A room config with no prep, timing overrides, interruptions or yielding. */
export const plainRoomConfig: RoomConfig = {
  preRoundPrep: { enabled: false },
  inRoundPrep: { enabled: false },
  speechTiming: { countdownMs: 0, segmentDurationOverrides: {} },
  crossExamination: { crossExMode: 'ordered' },
  interruptions: null,
  yielding: null,
};

/** Shared one-on-one format fixture for protocol and engine contract tests. */
export const oneOnOneFormatFixture: FormatDefinition = {
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

export const invalidFormatDefinitions: ReadonlyArray<
  readonly [string, FormatDefinition]
> = [
  [
    'unseated speaker',
    {
      ...oneOnOneFormatFixture,
      segments: oneOnOneFormatFixture.segments.map((segment, index) =>
        index === 0 ? { ...segment, slot: 99 } : segment,
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
  const segments = definition.segments.filter((s) => s.side === side);
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

export const unsafeFormatDefinitions: ReadonlyArray<
  readonly [string, FormatDefinition]
> = [
  ...(['affirmative', 'negative', 'judge'] as const).map(
    (role) =>
      [
        `billion ${role} seats`,
        {
          ...oneOnOneFormatFixture,
          seats: { ...oneOnOneFormatFixture.seats, [role]: 1_000_000_000 },
        },
      ] as const,
  ),
  [
    'over total with individually bounded roles',
    {
      ...oneOnOneFormatFixture,
      seats: { affirmative: 128, negative: 128, judge: 1 },
    },
  ],
  [
    'no negative seats',
    {
      ...onlySideSegments(oneOnOneFormatFixture, 'affirmative'),
      seats: { affirmative: 1, negative: 0, judge: 0 },
    },
  ],
  [
    'negative seats without speaking opportunity',
    onlySideSegments(oneOnOneFormatFixture, 'affirmative'),
  ],
  ...(['affirmative', 'negative', 'judge'] as const).map(
    (role) =>
      [
        `one over the role work bound: ${role}`,
        {
          ...oneOnOneFormatFixture,
          seats: { ...oneOnOneFormatFixture.seats, [role]: 257 },
        },
      ] as const,
  ),
  [
    'no affirmative seats',
    {
      ...onlySideSegments(oneOnOneFormatFixture, 'negative'),
      seats: { affirmative: 0, negative: 1, judge: 0 },
    },
  ],
  [
    'affirmative seats without speaking opportunity',
    onlySideSegments(oneOnOneFormatFixture, 'negative'),
  ],
  [
    'missing negative count',
    {
      ...oneOnOneFormatFixture,
      seats: { affirmative: 1, judge: 0 } as FormatDefinition['seats'],
    },
  ],
];

/** Rules resolved from a definition at its default timing. */
export const fixtureRules = (definition: FormatDefinition) => ({
  version: 2,
  seats: definition.seats,
  segments: definition.segments.map(({ defaultDurationMs, ...s }) => ({
    ...s,
    durationMs: defaultDurationMs,
  })),
  inRoundPrep: null,
  countdownMs: 0,
  interaction: { crossExMode: 'ordered', yield: null, interruptions: null },
});
