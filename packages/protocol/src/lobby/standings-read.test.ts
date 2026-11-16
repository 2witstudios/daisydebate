import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { authorizationCapabilitySchema } from '../authorization';
import {
  parseEach,
  parseOutcome,
  parsedUnchanged,
} from '../parse-outcome.test-support';
import {
  bracketViewSchema,
  standingsQuerySchema,
  standingsReadCatalogue,
  standingsViewSchema,
} from './standings-read';

setupRitewayBun();

const id = (seed: string) => seed.padEnd(24, 'x');

const row = {
  seed: 1,
  entry: {
    entryId: id('entryjensen'),
    shown: { kind: 'name', name: 'Jensen' },
  },
  responsible: { kind: 'school', name: 'Hartwell' },
  wins: 4,
  opponentWins: 9,
  rating: 1712,
  explanation: 'Only entry on 4 wins with 114.5',
  decidesBreak: false,
};
const shape = {
  lobbyId: id('lobby'),
  eventId: id('event'),
  division: null,
  throughRound: 4,
  progress: { kind: 'complete', ballots: 96 },
  tiebreaks: ['wins', 'total_points', 'opponent_wins', 'rating'],
  breakLine: { seeds: 8, tabRoundName: 'Quarterfinals' },
  breakAnnouncedAt: null,
  entryCount: 24,
};
const official = {
  ...shape,
  visibility: 'official',
  resultsVersion: 1,
  rows: [{ ...row, points: 114.5 }],
  capabilities: { announceBreak: true, previewCorrection: true },
};
const withScores = {
  ...shape,
  visibility: 'released_with_scores',
  rows: [{ ...row, points: 114.5 }],
};
const decisionsOnly = {
  ...shape,
  visibility: 'released_decisions',
  rows: [row],
};

const side = (seed: number, name: string) => ({
  entryId: id(`entry${name}`),
  seed,
  shown: { kind: 'name', name },
});
const tie = (state: unknown) => ({
  fixtureId: id('fixture'),
  entries: [side(1, 'jensen'), side(8, 'sato')],
  state,
});
const tabRound = (ties: readonly unknown[]) => ({
  tabRoundId: id('tabroundquarters'),
  name: 'Quarterfinals',
  status: 'complete',
  startsAt: null,
  fixtures: ties,
  waitsOn: null,
});
const bracketShape = {
  lobbyId: id('lobby'),
  eventId: id('event'),
  stageId: id('stage'),
  kind: 'elimination',
  division: null,
};
const decided = {
  kind: 'decided',
  resultId: id('result'),
  outcomes: [
    { entryId: id('entryjensen'), won: true, rank: null, ballotsWon: 3 },
    { entryId: id('entrysato'), won: false, rank: null, ballotsWon: 0 },
  ],
};
const live = {
  kind: 'live',
  room: { roomId: id('room'), name: 'Room 1' },
  watchable: false,
};
const withheld = { kind: 'withheld' };

describe('the standings read', () => {
  test('a variant for each audience that sees less', () => {
    assert({
      given:
        'an official, an audience with scores released and one with decisions only',
      should: 'parse each as it is',
      actual: parseEach(standingsViewSchema, [
        official,
        withScores,
        decisionsOnly,
      ]),
      expected: parsedUnchanged([official, withScores, decisionsOnly]),
    });
  });

  test('what a viewer may not see is absent', () => {
    assert({
      given:
        'speaker points with only decisions released, and host controls for an audience',
      should: 'refuse both',
      actual: parseEach(standingsViewSchema, [
        { ...decisionsOnly, rows: [{ ...row, points: 114.5 }] },
        { ...withScores, capabilities: official.capabilities },
      ]),
      expected: [{ issues: ['rows.0'] }, { issues: ['(root)'] }],
    });
  });

  test('a tiebreak outside the metrics', () => {
    assert({
      given: 'a tiebreak the engine does not know',
      should: 'refuse it',
      actual: parseEach(standingsViewSchema, [
        { ...official, tiebreaks: ['wins', 'coin_toss'] },
      ]),
      expected: [{ issues: ['tiebreaks.1'] }],
    });
  });
});

describe('the bracket read', () => {
  test('a result is withheld only from an audience', () => {
    const audience = {
      ...bracketShape,
      visibility: 'audience',
      tabRounds: [tabRound([tie(decided), tie(live), tie(withheld)])],
    };
    const host = {
      ...bracketShape,
      visibility: 'official',
      tabRounds: [tabRound([tie(decided), tie(live)])],
    };
    assert({
      given:
        'an audience with a withheld decision, an official, and an official told it is withheld',
      should: 'parse the first two and refuse the third',
      actual: parseEach(bracketViewSchema, [
        audience,
        host,
        { ...host, tabRounds: [tabRound([tie(withheld)])] },
      ]),
      expected: [
        ...parsedUnchanged([audience, host]),
        { issues: ['tabRounds.0.fixtures.0.state.kind'] },
      ],
    });
  });

  test('standings and the bracket answer under the standings gate', () => {
    assert({
      given: 'the standings read catalogue',
      should: 'name standings.read, a real capability, for each read',
      actual: Object.values(standingsReadCatalogue).map((read) =>
        read.gate.map((gate) =>
          parseOutcome(authorizationCapabilitySchema, gate),
        ),
      ),
      expected: [[{ data: 'standings.read' }], [{ data: 'standings.read' }]],
    });
  });
});

describe('a minor in the standings and the bracket', async () => {
  test('an entrant shown by initials, a family withheld', async () => {
    const minorRow = {
      ...row,
      entry: {
        entryId: id('entryokafor'),
        shown: { kind: 'initials', initials: 'C. O.' },
      },
      responsible: { kind: 'guardian', name: null },
      points: 81.5,
    };
    assert({
      given: 'a released table with a minor by initials and a withheld family',
      should: 'parse unchanged',
      actual: parseOutcome(standingsViewSchema, {
        ...withScores,
        rows: [minorRow],
      }),
      expected: { data: { ...withScores, rows: [minorRow] } },
    });
    assert({
      given: 'an entrant carried as a bare name with no shown form',
      should: 'refuse it',
      actual:
        'issues' in
        parseOutcome(standingsViewSchema, {
          ...withScores,
          rows: [
            { ...row, entry: { entryId: id('entryokafor'), name: 'Okafor' } },
          ],
        }),
      expected: true,
    });
  });
});

describe('standingsQuerySchema', () => {
  test('a table is read whole or by division', () => {
    assert({
      given:
        'the whole table, the novice division, a blank division and a page',
      should: 'accept the whole table and a named division only',
      actual: parseEach(standingsQuerySchema, [
        { eventId: id('event'), division: null },
        { eventId: id('event'), division: 'Novice' },
        { eventId: id('event'), division: ' ' },
        { eventId: id('event'), division: null, page: 2 },
      ]).map((outcome) => 'data' in outcome),
      expected: [true, true, false, false],
    });
  });
});

test('a bracket fixture retains every actual entry and outcome', () => {
  const entries = Array.from({ length: 4 }, (_, i) =>
    side(i + 1, `speaker${i}`),
  );
  const fixture = {
    fixtureId: id('section'),
    entries,
    state: {
      kind: 'decided',
      resultId: id('result'),
      outcomes: entries.map((entry, i) => ({
        entryId: entry.entryId,
        won: null,
        rank: i + 1,
        ballotsWon: null,
      })),
    },
  };
  const read = {
    ...bracketShape,
    visibility: 'official',
    tabRounds: [{ ...tabRound([]), fixtures: [fixture] }],
  };
  assert({
    given: 'a genuine four-entry section rather than a two-side pairing',
    should: 'retain all positions and actual ranks in the bracket contract',
    actual: parseOutcome(bracketViewSchema, read),
    expected: { data: read },
  });
});

test('a decided fixture cannot omit or substitute an entry outcome', () => {
  const fixture = tie(decided);
  const read = (one: unknown) => ({
    ...bracketShape,
    visibility: 'official',
    tabRounds: [tabRound([one])],
  });
  assert({
    given:
      'a duplicated fixture entry or a decided result with a missing or foreign entry',
    should:
      'refuse mismatched published positions instead of dropping an entry',
    actual: [
      { ...fixture, entries: [fixture.entries[0], fixture.entries[0]] },
      {
        ...fixture,
        state: { ...decided, outcomes: decided.outcomes.slice(0, 1) },
      },
      {
        ...fixture,
        state: {
          ...decided,
          outcomes: [
            decided.outcomes[0],
            { ...decided.outcomes[1], entryId: id('foreign') },
          ],
        },
      },
    ].map((fixture) => bracketViewSchema.safeParse(read(fixture)).success),
    expected: [false, false, false],
  });
});
