import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  daisyBallotSource,
  daisyWinnerBallot,
  judgeSeat,
  panelRuleFor,
  sideSeat,
  type RoundCompetitionSource,
} from '@daisy/protocol';
import { fixtureRules, oneOnOneFormatFixture } from '@daisy/protocol/testing';
import { createDecidedResultRecord } from './result-record-factory';

setupRitewayBun();
const id = (value: string) => value.repeat(24);
const source = (): RoundCompetitionSource => ({
  version: 1,
  format: { formatId: 'nsda-policy', formatVersion: 1 },
  source: {
    roundId: id('r'),
    freezeRevision: 1,
    finalization: { commandId: id('z'), resultingVersion: 8 },
    judgeAssignments: [
      {
        slot: 0,
        versions: [
          {
            version: 1,
            participantId: id('e'),
            actorId: id('j'),
            source: 'initial',
            commandId: null,
            recordedAt: '2026-11-15T09:00:00.000Z',
          },
        ],
      },
    ],
    rules: fixtureRules(oneOnOneFormatFixture),
    judging: {
      source: daisyBallotSource(daisyWinnerBallot),
      ballot: daisyWinnerBallot,
      panel: panelRuleFor(daisyWinnerBallot),
    },
  },
  cast: [
    { participantId: id('c'), actorId: id('a'), seat: sideSeat('affirmative') },
    { participantId: id('d'), actorId: id('b'), seat: sideSeat('negative') },
    { participantId: id('e'), actorId: id('j'), seat: judgeSeat(0) },
  ],
  panel: [
    {
      participantId: id('e'),
      ballot: {
        kind: 'submitted',
        ballotId: id('k'),
        contentDigest: 'a'.repeat(64),
        submittedAt: '2027-01-01T00:00:00.000Z',
        contribution: {
          rubricVersion: 'speaker-10@2',
          winner: 'affirmative',
          scores: {
            affirmative: Object.fromEntries(
              [
                'thesis',
                'burdens',
                'warrants',
                'coherence',
                'refutation',
                'weighing',
                'questioning',
                'answering',
                'organization',
                'delivery',
              ].map((key) => [key, 3]),
            ),
            negative: Object.fromEntries(
              [
                'thesis',
                'burdens',
                'warrants',
                'coherence',
                'refutation',
                'weighing',
                'questioning',
                'answering',
                'organization',
                'delivery',
              ].map((key) => [key, 3]),
            ),
          },
        },
      },
    },
  ],
});
const fixture = {
  kind: 'pairing' as const,
  entries: [
    { entryId: id('x'), position: 0, side: 'affirmative' },
    { entryId: id('y'), position: 1, side: 'negative' },
  ],
};
const judges = [{ id: id('t'), actorId: id('j') }];
test('the result factory retains the published terminal source and actual cast without current roster inputs', () => {
  const published = source();
  const answer = createDecidedResultRecord(published, fixture, judges);
  assert({
    given:
      'an actual-source-shaped terminal export and immutable fixture positions',
    should:
      'retain exact terminal reference, cast, original submission and durable judge identity',
    actual:
      answer.kind === 'created'
        ? {
            source: answer.record.source,
            entries: answer.record.cast.map((person) => person.entryId),
            panel: answer.record.panel,
          }
        : answer,
    expected: {
      source: published.source,
      entries: [id('x'), id('y'), null],
      panel: published.panel.map((row) => ({
        ...row,
        tournamentJudgeId: id('t'),
      })),
    },
  });
  assert({
    given: 'a missing durable judge or duplicate fixture position',
    should: 'refuse rather than invent identities',
    actual: [
      createDecidedResultRecord(published, fixture, []),
      createDecidedResultRecord(
        published,
        {
          ...fixture,
          entries: fixture.entries.map((row) => ({ ...row, position: 1 })),
        },
        judges,
      ),
    ].map((answer) => answer.kind),
    expected: ['refused', 'refused'],
  });
});
