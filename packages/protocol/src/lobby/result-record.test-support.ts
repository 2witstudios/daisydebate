import { ballotCategories } from '../ballot';
import {
  daisyWinnerBallot,
  panelRuleFor,
  daisyBallotSource,
} from '../ballot-definition';
import {
  fixtureRules,
  oneOnOneFormatFixture,
} from '../format-fixtures.test-support';
import { judgeSeat, sideSeat } from '../seats';
import type { ResultCompetitionRecord } from './result-record';
export const recordId = (s: string) => s.repeat(24);
export const criterionScores = (n: number) =>
  Object.fromEntries(ballotCategories.map((key) => [key, n]));
export const decidedRecord = () =>
  ({
    version: 1,
    kind: 'decided',
    format: { formatId: 'freestyle', formatVersion: 1 },
    fixture: {
      kind: 'pairing',
      entries: [
        { entryId: recordId('a'), side: 'affirmative' },
        { entryId: recordId('b'), side: 'negative' },
      ],
    },
    source: {
      roundId: recordId('r'),
      freezeRevision: 1,
      rules: fixtureRules(oneOnOneFormatFixture),
      judging: {
        source: daisyBallotSource(daisyWinnerBallot),
        ballot: daisyWinnerBallot,
        panel: panelRuleFor(daisyWinnerBallot),
      },
    },
    pointUnit: { numerator: '1', denominator: '1' },
    cast: [
      {
        participantId: recordId('c'),
        actorId: recordId('d'),
        entryId: recordId('a'),
        seat: sideSeat('affirmative'),
      },
      {
        participantId: recordId('e'),
        actorId: recordId('f'),
        entryId: recordId('b'),
        seat: sideSeat('negative'),
      },
      {
        participantId: recordId('g'),
        actorId: recordId('h'),
        entryId: null,
        seat: judgeSeat(0),
      },
    ],
    panel: [
      {
        tournamentJudgeId: recordId('j'),
        participantId: recordId('g'),
        ballot: {
          kind: 'submitted',
          ballotId: recordId('k'),
          contentDigest: 'a'.repeat(64),
          submittedAt: '2027-01-01T00:00:00.000Z',
          contribution: {
            rubricVersion: 'speaker-10@2',
            winner: 'affirmative',
            scores: {
              affirmative: criterionScores(4),
              negative: criterionScores(3),
            },
          },
        },
      },
    ],
  }) satisfies Extract<ResultCompetitionRecord, { kind: 'decided' }>;
