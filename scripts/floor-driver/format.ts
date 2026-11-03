import {
  foundationDefinition,
  foundationSettings,
} from '@daisy/db/reference-formats';

/** A format may have no more (DEC-131), and one Round gives one deadline fewer. */
const MAX_SPEECHES = 64;
const SPEECH_MS = 240_000;

/** Speeches for `deadlines` boundaries: the first speech opens with no measure. */
export const speechesFor = (deadlines: number) =>
  Math.min(MAX_SPEECHES, Math.max(2, deadlines + 1));

/** A custom selection of alternating speeches, unjudged, each ended by a yield. */
export const floorSelection = (input: {
  readonly countdownMs: number;
  readonly speeches: number;
}) => {
  const segments = Array.from({ length: input.speeches }, (_, index) => ({
    key: `S${index}`,
    label: `Speech ${index + 1}`,
    type: 'speech' as const,
    side: index % 2 === 0 ? ('affirmative' as const) : ('negative' as const),
    slot: 0,
    defaultDurationMs: SPEECH_MS,
  }));
  return {
    kind: 'custom' as const,
    competitionType: 'casual' as const,
    definition: {
      ...foundationDefinition,
      seats: { affirmative: 1, negative: 1, judge: 0 },
      segments,
      configurable: {
        ...foundationDefinition.configurable,
        timing: {
          ...foundationDefinition.configurable.timing,
          segmentDurationMs: Object.fromEntries(
            segments.map(({ key }) => [
              key,
              { min: SPEECH_MS, max: SPEECH_MS },
            ]),
          ),
        },
        interaction: {
          ...foundationDefinition.configurable.interaction,
          yield: {
            enabledChoices: [true, false],
            returnsTimeChoices: [true, false],
          },
        },
      },
    },
    config: {
      ...foundationSettings,
      preRoundPrep: { enabled: false as const },
      resolutionDraw: { enabled: false as const },
      inRoundPrep: { enabled: false as const },
      speechTiming: {
        countdownMs: input.countdownMs,
        segmentDurationOverrides: {},
      },
      yielding: { allowed: true, returnsTime: false },
    },
  };
};
