import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { authorizationCapabilitySchema } from '../authorization';
import { parseEach, parseOutcome, parsedUnchanged } from '../parse-outcome.test-support';
import {
  bracketViewSchema,
  standingsReadCatalogue,
  standingsViewSchema,
} from './standings-read';

setupRitewayBun();

const id = (seed: string) => seed.padEnd(24, 'x');

const row = {
  seed: 1,
  entry: { entryId: id('entryjensen'), name: 'Jensen' },
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
  rows: [{ ...row, points: 114.5 }],
  capabilities: { announceBreak: true, previewCorrection: true },
};
const withScores = {
  ...shape,
  visibility: 'released_with_scores',
  rows: [{ ...row, points: 114.5 }],
};
const decisionsOnly = { ...shape, visibility: 'released_decisions', rows: [row] };

const side = (seed: number, name: string) => ({
  entryId: id(`entry${name}`),
  seed,
  name,
});
const tie = (state: unknown) => ({
  fixtureId: id('fixture'),
  top: side(1, 'jensen'),
  bottom: side(8, 'sato'),
  state,
});
const tabRound = (ties: readonly unknown[]) => ({
  tabRoundId: id('tabroundquarters'),
  name: 'Quarterfinals',
  status: 'complete',
  startsAt: null,
  ties,
  waitsOn: null,
});
const bracketShape = {
  lobbyId: id('lobby'),
  eventId: id('event'),
  stageId: id('stage'),
  division: null,
};
const decided = { kind: 'decided', topBallots: 3, bottomBallots: 0 };
const live = {
  kind: 'live',
  room: { roomId: id('room'), name: 'Room 1' },
  watchable: false,
};
const withheld = { kind: 'withheld' };

describe('the standings read', () => {
  test('a variant for each audience that sees less', () => {
    assert({
      given: 'an official, an audience with scores released and one with decisions only',
      should: 'parse each as it is',
      actual: parseEach(standingsViewSchema, [official, withScores, decisionsOnly]),
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
      given: 'an audience with a withheld decision, an official, and an official told it is withheld',
      should: 'parse the first two and refuse the third',
      actual: parseEach(bracketViewSchema, [
        audience,
        host,
        { ...host, tabRounds: [tabRound([tie(withheld)])] },
      ]),
      expected: [
        ...parsedUnchanged([audience, host]),
        { issues: ['tabRounds.0.ties.0.state.kind'] },
      ],
    });
  });

  test('standings and the bracket answer under the standings gate', () => {
    assert({
      given: 'the standings read catalogue',
      should: 'name standings.read, a real capability, for each read',
      actual: Object.values(standingsReadCatalogue).map((read) =>
        read.gate.map((gate) => parseOutcome(authorizationCapabilitySchema, gate)),
      ),
      expected: [[{ data: 'standings.read' }], [{ data: 'standings.read' }]],
    });
  });
});
