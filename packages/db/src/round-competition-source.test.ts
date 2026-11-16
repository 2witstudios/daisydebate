import { drizzle } from 'drizzle-orm/bun-sql';
import { assertRejects } from '@daisy/errors/testing';
import {
  ballotCategories,
  daisyBallotSource,
  daisyWinnerBallot,
  panelRuleFor,
  sideSeat,
  judgeSeat,
} from '@daisy/protocol';
import { fixtureRules, oneOnOneFormatFixture } from '@daisy/protocol/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fakeSql } from './scripted-bun-wire';
import { readRoundCompetitionSource } from './round-competition-source';
setupRitewayBun();
const id = (letter: string) => letter.repeat(24);
const rules = fixtureRules(oneOnOneFormatFixture);
const judging = {
  source: daisyBallotSource(daisyWinnerBallot),
  ballot: daisyWinnerBallot,
  panel: panelRuleFor(daisyWinnerBallot),
};
const scores = Object.fromEntries(
  ['affirmative', 'negative'].map((side) => [
    side,
    Object.fromEntries(ballotCategories.map((category) => [category, 3])),
  ]),
);
const frame = ['one-on-one', 1, rules, judging, id('f'), 21, 2, 'judged'];
const cast = [
  [id('a'), id('b'), 'side', 'affirmative', 0],
  [id('c'), id('d'), 'side', 'negative', 0],
  [id('j'), id('k'), 'judge', null, 0],
];
const recordedAt = new Date('2026-11-15T09:00:00.000Z');
const lineage = [[0, 1, id('j'), id('k'), 'initial', null, recordedAt]];
const ballot = [
  id('m'),
  id('j'),
  'speaker-10@2',
  'win',
  'affirmative',
  null,
  scores,
  null,
  null,
  null,
  new Date('2026-11-15T10:00:00.000Z'),
  'e'.repeat(64),
  true,
];
const input = { roundId: id('r'), roomId: id('q') };
test('Round publishes exact consumed competition values without loading private words', async () => {
  const { client, queries } = fakeSql([[frame], lineage, cast, [ballot]]);
  const actual = await readRoundCompetitionSource(drizzle({ client }), input);
  assert({
    given: 'a completed judged Round and its exact consumed witness',
    should:
      'export frozen references, real ordered cast and original competitive contribution only',
    actual: [
      actual,
      queries[0]?.query.includes('for share of "r"'),
      queries.some(
        ({ query }) =>
          query.includes('"reason"') ||
          query.includes('"feedback"') ||
          query.includes('"citations"'),
      ),
    ],
    expected: [
      {
        version: 1,
        format: { formatId: 'one-on-one', formatVersion: 1 },
        source: {
          roundId: input.roundId,
          freezeRevision: 2,
          finalization: { commandId: id('f'), resultingVersion: 21 },
          rules,
          judging,
          judgeAssignments: [
            {
              slot: 0,
              versions: [
                {
                  version: 1,
                  participantId: id('j'),
                  actorId: id('k'),
                  source: 'initial',
                  commandId: null,
                  recordedAt: recordedAt.toISOString(),
                },
              ],
            },
          ],
        },
        cast: [
          {
            participantId: id('a'),
            actorId: id('b'),
            seat: sideSeat('affirmative'),
          },
          {
            participantId: id('c'),
            actorId: id('d'),
            seat: sideSeat('negative'),
          },
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
                scores,
              },
            },
          },
        ],
      },
      true,
      false,
    ],
  });
});
test('a non-judged ending exports no invented panel', async () => {
  const { client, queries } = fakeSql([
    [frame.map((value, index) => (index === 7 ? 'forfeit' : value))],
  ]);
  assert({
    given: 'a genuine forfeit ending with no consumed competitive panel',
    should: 'return no panel source and stop before reading ballots',
    actual: [
      await readRoundCompetitionSource(drizzle({ client }), input),
      queries.length,
    ],
    expected: [null, 1],
  });
});
test('changed consumed content fails before any result can use it', async () => {
  const { client } = fakeSql([
    [frame],
    lineage,
    cast,
    [ballot.map((value, index) => (index === 12 ? false : value))],
  ]);
  await assertRejects({
    given: 'a mismatched consumed content digest',
    should: 'refuse corrupt provenance rather than silently rebuild a panel',
    actual: () => readRoundCompetitionSource(drizzle({ client }), input),
    code: 'INVARIANT',
  });
});
