import type { RoomCatalogChoice } from '@daisy/protocol';

export const humanRoundSelection = (
  choice: RoomCatalogChoice,
  judgeSeats: 0 | 1 | 2,
) => ({
  kind: 'custom',
  length: 'full',
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
    ...choice.defaultConfig,
    preRoundPrep: { enabled: false },
    inRoundPrep: { enabled: false },
    speechTiming: { countdownMs: 0, segmentDurationOverrides: {} },
    yielding: { allowed: true, returnsTime: false },
  },
});
