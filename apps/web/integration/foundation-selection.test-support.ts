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
