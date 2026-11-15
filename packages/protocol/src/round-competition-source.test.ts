import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ballotCategories } from './ballot';
import {
  daisyBallotSource,
  daisyWinnerBallot,
  panelRuleFor,
} from './ballot-definition';
import {
  fixtureRules,
  oneOnOneFormatFixture,
} from './format-fixtures.test-support';
import { judgeSeat, sideSeat } from './seats';
import {
  roundCompetitionSourceSchema,
  type RoundCompetitionSource,
} from './round-competition-source';
setupRitewayBun();
const id = (letter: string) => letter.repeat(24);
const source = () =>
  ({
    version: 1,
    format: { formatId: 'one-on-one', formatVersion: 1 },
    source: {
      roundId: id('r'),
      freezeRevision: 2,
      finalization: { commandId: id('f'), resultingVersion: 21 },
      rules: fixtureRules(oneOnOneFormatFixture),
      judging: {
        source: daisyBallotSource(daisyWinnerBallot),
        ballot: daisyWinnerBallot,
        panel: panelRuleFor(daisyWinnerBallot),
      },
    },
    cast: [
      {
        participantId: id('a'),
        actorId: id('b'),
        seat: sideSeat('affirmative'),
      },
      { participantId: id('c'), actorId: id('d'), seat: sideSeat('negative') },
      { participantId: id('j'), actorId: id('k'), seat: judgeSeat(0) },
    ],
    panel: [
      {
        participantId: id('j'),
        ballot: {
          kind: 'submitted',
          ballotId: id('m'),
          contentDigest: 'e'.repeat(64),
          submittedAt: '2026-11-15T10:00:00.000Z',
          contribution: {
            rubricVersion: 'speaker-10@2',
            winner: 'affirmative',
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
      },
    ],
  }) satisfies RoundCompetitionSource;
test('the published Round competition source contains exact frozen references and competitive values only', () => {
  const actual = source();
  assert({
    given:
      'an actual execution-shaped cast, ordered panel and finalization identity',
    should: 'validate its published competition output without private words',
    actual: roundCompetitionSourceSchema.parse(actual),
    expected: actual,
  });
});
test('Round competition export rejects private words, missing cast, wrong panel identity or malformed provenance', () => {
  const valid = source();
  const judge = valid.panel[0]!;
  const invalid = [
    {
      ...valid,
      panel: [
        {
          ...judge,
          ballot: {
            ...judge.ballot,
            contribution: {
              ...judge.ballot.contribution,
              reason: 'Private original reason',
            },
          },
        },
      ],
    },
    { ...valid, cast: valid.cast.slice(1) },
    { ...valid, cast: [valid.cast[1], valid.cast[0], valid.cast[2]] },
    { ...valid, panel: [{ ...judge, participantId: id('z') }] },
    {
      ...valid,
      panel: [{ ...judge, ballot: { ...judge.ballot, contentDigest: 'bad' } }],
    },
    {
      ...valid,
      source: {
        ...valid.source,
        finalization: { ...valid.source.finalization, resultingVersion: 0 },
      },
    },
  ];
  assert({
    given:
      'private content, incomplete/reordered cast, a foreign judge or invalid provenance',
    should: 'refuse every false published source without substituting content',
    actual: invalid.map(
      (value) => roundCompetitionSourceSchema.safeParse(value).success,
    ),
    expected: invalid.map(() => false),
  });
});
