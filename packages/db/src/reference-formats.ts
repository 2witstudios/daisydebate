import type { FormatDefinition, RoomConfig } from '@daisy/protocol';

/**
 * The reference formats, as TypeScript, for tooling that runs without a
 * database (scenarios, invariants, the agent seed). The database gets them
 * from the migrations, never from `db:seed` (ADR 0038):
 * `reference-formats.test.ts` fails when this file and the rows the
 * migrations insert disagree. A definition is immutable reference data;
 * publishing a revision appends a row to `format_revisions` and moves the
 * pointer, never rewrites this one.
 */

/** The prep capability both reference formats grant: 0-10 minutes per side, spendable before speeches. */
const referenceInRoundPrepCapability: FormatDefinition['configurable']['inRoundPrep'] =
  {
    budgetMsPerSide: { min: 0, max: 600_000 },
    spendableBefore: ['speech'],
    expiresAtSegment: null,
  };

/** The one-on-one format: the schedule, defaults and capabilities. */
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
    inRoundPrep: referenceInRoundPrepCapability,
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

/** The architectural proof format: two speeches, unjudged, no interaction. */
export const foundationDefinition: FormatDefinition = {
  version: 1,
  seats: { affirmative: 1, negative: 1, judge: 0 },
  segments: [
    {
      key: 'AC',
      label: 'Affirmative constructive',
      type: 'speech',
      side: 'affirmative',
      slot: 0,
      defaultDurationMs: 240_000,
    },
    {
      key: 'NC',
      label: 'Negative constructive',
      type: 'speech',
      side: 'negative',
      slot: 0,
      defaultDurationMs: 240_000,
    },
  ],
  configurable: {
    timing: {
      segmentDurationMs: {
        AC: { min: 60_000, max: 600_000 },
        NC: { min: 60_000, max: 600_000 },
      },
      countdownMs: { min: 0, max: 60_000 },
    },
    inRoundPrep: referenceInRoundPrepCapability,
    preRoundPrep: null,
    interaction: {
      crossExModes: ['ordered'],
      interruptions: null,
      yield: null,
    },
  },
};

/** The foundation room's config: the proof format at its sanctioned defaults. */
export const foundationConfig: RoomConfig = {
  preRoundPrep: { enabled: false },
  inRoundPrep: { enabled: true, budgetMsPerSide: 120_000 },
  speechTiming: { countdownMs: 10_000, segmentDurationOverrides: {} },
  crossExamination: { crossExMode: 'ordered' },
  interruptions: null,
  yielding: null,
};

export const referenceFormats: ReadonlyArray<{
  readonly id: string;
  readonly name: string;
  readonly definition: FormatDefinition;
}> = [
  {
    id: 'one-on-one',
    name: 'One-on-one',
    definition: oneOnOneDefinition,
  },
  {
    id: 'foundation',
    name: 'Foundation (architectural proof)',
    definition: foundationDefinition,
  },
];

/** The casual config a practice room starts from: defaults, prep enabled. */
export const practiceRoomConfig: RoomConfig = {
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

/** The sanctioned full-length ranked config for one-on-one. */
export const oneOnOneFullConfig: RoomConfig = {
  preRoundPrep: { enabled: true, durationMs: 1_200_000 },
  inRoundPrep: { enabled: true, budgetMsPerSide: 240_000 },
  speechTiming: { countdownMs: 10_000, segmentDurationOverrides: {} },
  crossExamination: { crossExMode: 'ordered' },
  interruptions: { mode: 'cross_ex_only', minRemainingMs: 30_000 },
  yielding: { allowed: true, returnsTime: true },
};

/** The sanctioned quick-length ranked config: the same debate, shortened. */
const oneOnOneQuickConfig: RoomConfig = {
  ...oneOnOneFullConfig,
  inRoundPrep: { enabled: true, budgetMsPerSide: 120_000 },
  speechTiming: {
    countdownMs: 10_000,
    segmentDurationOverrides: {
      AC: 150_000,
      CX1: 60_000,
      NC: 180_000,
      CX2: 60_000,
      '1AR': 150_000,
      NR: 150_000,
      '2AR': 90_000,
    },
  },
};

export const referencePresets: ReadonlyArray<{
  readonly formatId: string;
  readonly length: 'full' | 'quick';
  readonly version: number;
  readonly formatVersion: number;
  readonly config: RoomConfig;
}> = [
  {
    formatId: 'one-on-one',
    length: 'full',
    version: 1,
    formatVersion: 1,
    config: oneOnOneFullConfig,
  },
  {
    formatId: 'one-on-one',
    length: 'quick',
    version: 1,
    formatVersion: 1,
    config: oneOnOneQuickConfig,
  },
];

/** The bot actors the migrations seed, keyed by the roster's slug. */
export const referenceBots: ReadonlyArray<{
  readonly actorId: string;
  readonly name: string;
  readonly persona: string;
  readonly voice: string;
  readonly difficulty: 'beginner' | 'intermediate' | 'advanced';
}> = [
  {
    actorId: 'j9u2n6o1b4r8o2s5a9c1d3e7',
    name: 'Juno',
    persona:
      'Wears every feeling on its sleeve, tells long stories, and cannot help being enthusiastic about almost anything.',
    voice: 'aura-2-aurora-en',
    difficulty: 'beginner',
  },
  {
    actorId: 'w2r5e8n1b4o7t0a3n6i9c2e5',
    name: 'Wren',
    persona:
      'Sarcastic in a friendly way, always has a comeback, and is never quite as unimpressed as it sounds.',
    voice: 'aura-2-thalia-en',
    difficulty: 'intermediate',
  },
  {
    actorId: 'b1r4a7m0b3r6a9n2c5h8e1s4',
    name: 'Bram',
    persona:
      'Steady and methodical, prefers structure over flourishes, and answers exactly what was asked.',
    voice: 'aura-2-arcas-en',
    difficulty: 'advanced',
  },
];

/** The AI judge actor every AI-balloted round seats in the judge chair. */
export const referenceAiJudge = {
  actorId: 'a1i2j3u4d5g6e7a8i9j0u1d2',
  name: 'The Panel',
  persona: 'A careful judge that rules only on what the round said.',
  voice: 'aura-2-thalia-en',
  difficulty: 'advanced' as const,
};
