import {
  ballotCategories,
  daisyWinnerBallot,
  daisyBallotSource,
  judgeSeat,
  sideSeat,
  panelRuleFor,
} from '@daisy/protocol';
import { fixtureRules, oneOnOneFormatFixture } from '@daisy/protocol/testing';
import type { ResultCompetitionRecord } from '@daisy/protocol/lobby/result-record';
const id = (letter: string) => letter.repeat(24);
/** Explicit synthetic source contract for pure command tests; not a played tournament claim. */
export const fixtureCompetition = (): Extract<
  ResultCompetitionRecord,
  { kind: 'decided' }
> => ({
  version: 1,
  kind: 'decided',
  format: { formatId: 'freestyle', formatVersion: 1 },
  fixture: {
    kind: 'pairing',
    entries: [
      { entryId: id('a'), side: 'affirmative' },
      { entryId: id('b'), side: 'negative' },
    ],
  },
  source: {
    roundId: id('d'),
    freezeRevision: 1,
    finalization: { commandId: id('z'), resultingVersion: 8 },
    rules: fixtureRules({
      ...oneOnOneFormatFixture,
      seats: { ...oneOnOneFormatFixture.seats, judges: 3 },
    }),
    judging: {
      source: daisyBallotSource(daisyWinnerBallot),
      ballot: daisyWinnerBallot,
      panel: panelRuleFor(daisyWinnerBallot, 3),
    },
  },
  pointUnit: { numerator: '1', denominator: '1' },
  cast: [
    {
      participantId: id('1'),
      actorId: id('1'),
      entryId: id('a'),
      seat: sideSeat('affirmative'),
    },
    {
      participantId: id('2'),
      actorId: id('2'),
      entryId: id('b'),
      seat: sideSeat('negative'),
    },
    ...['3', '4', '5'].map((letter, slot) => ({
      participantId: id(letter),
      actorId: id(letter),
      entryId: null,
      seat: judgeSeat(slot),
    })),
  ],
  panel: ['3', '4', '5'].map((letter, index) => ({
    tournamentJudgeId: id(['j', 'k', 'n'][index]!),
    participantId: id(letter),
    ballot: {
      kind: 'submitted',
      ballotId: id(['x', 'y', 'z'][index]!),
      contentDigest: letter.repeat(64),
      submittedAt: '2026-11-14T09:00:00.000Z',
      contribution: {
        rubricVersion: 'speaker-10@2',
        winner: index === 2 ? 'negative' : 'affirmative',
        scores: Object.fromEntries(
          ['affirmative', 'negative'].map((side) => [
            side,
            Object.fromEntries(
              ballotCategories.map((category) => [category, 3]),
            ),
          ]),
        ),
      },
    },
  })),
});
export const fixtureAdministrativeContext = () => {
  const record = fixtureCompetition();
  return {
    format: record.format,
    ballotSource: record.source.judging.source,
    definition: record.source.judging.ballot,
    pointUnit: record.pointUnit,
    sourceRoundId: record.source.roundId,
    fixture: {
      kind: 'pairing' as const,
      entries: record.fixture.entries.map((entry) => ({
        ...entry,
        members: record.cast
          .filter((person) => person.entryId === entry.entryId)
          .map((person) => person.actorId),
      })),
    },
  };
};
export const fixtureAwards = {
  kind: 'winner' as const,
  entries: [
    {
      entryId: id('a'),
      won: false,
      ballotCredits: 1,
      rankCredits: [],
      points: { kind: 'none' as const },
    },
    {
      entryId: id('b'),
      won: true,
      ballotCredits: 2,
      rankCredits: [],
      points: { kind: 'none' as const },
    },
  ],
};
export const fixtureReplacement = () => ({
  kind: 'decided' as const,
  contributions: fixtureCompetition().panel.flatMap((judge, index) =>
    judge.ballot.kind === 'submitted'
      ? [
          {
            participantId: judge.participantId,
            contribution: {
              ...judge.ballot.contribution,
              winner:
                index === 0 ? 'negative' : judge.ballot.contribution.winner,
            },
          },
        ]
      : [],
  ),
});
