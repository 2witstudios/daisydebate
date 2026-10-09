import {
  formatDefinitionSchema,
  roomConfigSchema,
  type RoomCreate,
} from '@daisy/protocol';
/** Declared proof format, persisted through canonical custom-create, never a mock view. */
export const launchCustomSelection = {
  kind: 'custom' as const,
  competitionType: 'casual' as const,
  definition: formatDefinitionSchema.parse({
    version: 1,
    seats: { affirmative: 2, negative: 1, judge: 1 },
    segments: [
      {
        key: 'N1',
        label: 'Negative opening',
        type: 'speech',
        side: 'negative',
        slot: 0,
        defaultDurationMs: 7000,
      },
      {
        key: 'A2',
        label: 'Second affirmative',
        type: 'speech',
        side: 'affirmative',
        slot: 1,
        defaultDurationMs: 13000,
      },
      {
        key: 'A1',
        label: 'First affirmative closing',
        type: 'speech',
        side: 'affirmative',
        slot: 0,
        defaultDurationMs: 11000,
      },
    ],
    configurable: {
      timing: {
        segmentDurationMs: {
          N1: { min: 1000, max: 60000 },
          A2: { min: 1000, max: 60000 },
          A1: { min: 1000, max: 60000 },
        },
        countdownMs: { min: 0, max: 5000 },
      },
      preRoundPrep: null,
      inRoundPrep: null,
      interaction: {
        crossExModes: ['ordered'],
        interruptions: null,
        yield: null,
      },
    },
  }),
  config: roomConfigSchema.parse({
    preRoundPrep: { enabled: false },
    inRoundPrep: { enabled: false },
    speechTiming: { countdownMs: 0, segmentDurationOverrides: {} },
    crossExamination: { crossExMode: 'ordered' },
    interruptions: null,
    yielding: null,
  }),
} satisfies Extract<RoomCreate['selection'], { kind: 'custom' }>;
