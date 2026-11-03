import { foundationDefinition } from '@daisy/db/reference-formats';
import { foundationProofConfig } from '../../integration/foundation-selection.test-support';
import type { FormatDefinition, RoomConfig } from '@daisy/protocol';

export type ProofChoice = {
  readonly definition: FormatDefinition;
  readonly preset: { readonly config: RoomConfig };
};

/**
 * The two-speech proof format the browser journeys run. It is not in the
 * picker's catalog (FMT-1), so journeys post it as a custom format.
 */
export const foundationChoice: ProofChoice = {
  definition: foundationDefinition,
  preset: { config: foundationProofConfig },
};

/**
 * The proof format with a third speech, for a journey that needs the floor to
 * come back: in two speeches, ending the second finishes the Round.
 */
export const floorReturnsChoice: ProofChoice = {
  ...foundationChoice,
  definition: {
    ...foundationDefinition,
    segments: [
      ...foundationDefinition.segments,
      {
        key: 'AR',
        label: 'Affirmative rebuttal',
        type: 'speech',
        side: 'affirmative',
        slot: 0,
        defaultDurationMs: 240_000,
      },
    ],
    configurable: {
      ...foundationDefinition.configurable,
      timing: {
        ...foundationDefinition.configurable.timing,
        segmentDurationMs: {
          ...foundationDefinition.configurable.timing.segmentDurationMs,
          AR: { min: 60_000, max: 600_000 },
        },
      },
    },
  },
};

export const humanRoundSelection = (
  choice: ProofChoice,
  judgeSeats: 0 | 1 | 2,
  countdownMs = 0,
) => ({
  kind: 'custom',
  competitionType: 'casual',
  definition: {
    ...choice.definition,
    seats: { affirmative: 1, negative: 1, judge: judgeSeats },
    configurable: {
      ...choice.definition.configurable,
      interaction: {
        ...choice.definition.configurable.interaction,
        yield: {
          enabledChoices: [true, false],
          returnsTimeChoices: [true, false],
        },
      },
    },
  },
  config: {
    ...choice.preset.config,
    preRoundPrep: { enabled: false },
    resolutionDraw: { enabled: false },
    inRoundPrep: { enabled: false },
    speechTiming: { countdownMs, segmentDurationOverrides: {} },
    yielding: { allowed: true, returnsTime: false },
  },
});
