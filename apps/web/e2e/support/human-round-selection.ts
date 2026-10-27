import { foundationDefinition } from '@daisy/db/reference-formats';
import { foundationProofConfig } from '../../integration/foundation-selection.test-support';
import type { FormatDefinition, RoomConfig } from '@daisy/protocol';

type ProofChoice = {
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

export const humanRoundSelection = (
  choice: ProofChoice,
  judgeSeats: 0 | 1 | 2,
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
    inRoundPrep: { enabled: false },
    speechTiming: { countdownMs: 0, segmentDurationOverrides: {} },
    yielding: { allowed: true, returnsTime: false },
  },
});
