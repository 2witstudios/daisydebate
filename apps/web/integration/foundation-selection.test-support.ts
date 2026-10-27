import {
  foundationConfig,
  foundationDefinition,
} from '@daisy/db/reference-formats';

/** The proof format as a custom selection: unjudged, two speeches, never listed in the picker. */
export const foundationSelection = {
  kind: 'custom',
  definition: foundationDefinition,
  config: foundationConfig,
  competitionType: 'casual',
} as const;
