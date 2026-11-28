import { pointsOfInformationBounds } from '@daisy/protocol/format-settings';
import { foundationDefinition } from '@daisy/db/reference-formats';
import { plainRoomConfig } from '@daisy/protocol/testing';

/**
 * The proof format's room config in browser and integration suites: no prep
 * and no countdown, so a suite runs the two speeches and nothing else.
 */
export const foundationProofConfig = plainRoomConfig;

/** The proof format as a custom selection: unjudged, two speeches, never listed in the picker. */
export const foundationSelection = {
  kind: 'custom',
  definition: foundationDefinition,
  config: foundationProofConfig,
  competitionType: 'casual',
} as const;

/**
 * The proof format taking points of information: offers open 10 s into a
 * speech, a point runs 5 s and an unanswered offer lapses after 5 s.
 */
export const pointsOfInformationSelection = {
  kind: 'custom',
  definition: {
    ...foundationDefinition,
    configurable: {
      ...foundationDefinition.configurable,
      interaction: {
        ...foundationDefinition.configurable.interaction,
        pointsOfInformation: pointsOfInformationBounds,
      },
    },
  },
  config: {
    ...foundationProofConfig,
    pointsOfInformation: {
      enabled: true,
      protectedStartMs: 10_000,
      protectedEndMs: 30_000,
      maxDurationMs: 5_000,
      offerLapseMs: 5_000,
    },
  },
  competitionType: 'casual',
} as const;
