import type { BallotDefinition } from '@daisy/protocol';
import type { EventBallotAuthoringView } from '@daisy/protocol/lobby/ballot-read';

/** A league's stored ballot: a holistic 20 to 30 winner ballot in halves. */
export const leagueBallotV2: BallotDefinition = {
  key: 'ballot-league',
  revision: 2,
  decision: {
    kind: 'winner',
    lowPointWin: false,
    tie: false,
    doubleLoss: true,
  },
  points: {
    per: 'side',
    scale: { min: 20, max: 30, step: 0.5 },
    default: 27,
    criteria: { kind: 'holistic' },
    weights: null,
  },
  speakerRanks: false,
  written: { reason: { required: true, max: 2000 }, feedback: null },
};

/** Its next version: ranked sides, no scores. */
export const leagueBallotV3: BallotDefinition = {
  key: 'ballot-league',
  revision: 3,
  decision: { kind: 'ranking', of: 'sides', ties: false },
  points: null,
  speakerRanks: false,
  written: { reason: null, feedback: null },
};

export const leagueDefinitionId = 'k5x0e8w2q9m3n7b1c4v6z8aa';

/** A stored event on version 2 of the league's ballot, editable. */
export const authoringView = (
  overrides: Partial<EventBallotAuthoringView> = {},
): EventBallotAuthoringView => ({
  lobbyId: 'l5x0e8w2q9m3n7b1c4v6z8aa',
  eventId: 'e5x0e8w2q9m3n7b1c4v6z8aa',
  name: 'Varsity debate',
  label: null,
  versions: { lobby: 3, event: 2, settings: 4 },
  definition: {
    source: { kind: 'stored', id: leagueDefinitionId, version: 2 },
    ballot: leagueBallotV2,
  },
  sourceName: 'League ballot',
  followsTemplate: false,
  entriesExist: false,
  segments: [],
  screening: 'hold',
  definitions: [
    {
      id: leagueDefinitionId,
      name: 'League ballot',
      owned: true,
      currentVersion: 3,
      versions: [
        { version: 2, definition: leagueBallotV2, compatible: true },
        { version: 3, definition: leagueBallotV3, compatible: true },
      ],
    },
  ],
  capabilities: { publish: true, pin: true, setScreening: true },
  ...overrides,
});

/** The publish form's fields as a host fills them in. */
export const publishForm = (
  fields: Readonly<Record<string, string>>,
): FormData => {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
};

/** A complete draft: a holistic winner ballot from 1 to 10, ties allowed. */
export const completeDraft = {
  'publish-target': 'new',
  'definition-name': 'Novice ballot',
  decision: 'winner',
  ties: 'on',
  'score-subject': 'side',
  'criteria-kind': 'holistic',
  'score-min': '1',
  'score-max': '10',
  'score-step': '1',
  'score-default': '7',
  'reason-rule': 'optional',
  'reason-max': '500',
  'feedback-rule': 'off',
} as const;
