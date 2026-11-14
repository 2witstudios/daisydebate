import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseOutcome } from '../parse-outcome.test-support';
import {
  ballotReadCatalogue,
  ballotViewSchema,
  eventBallotViewSchema,
  judgeBallotViewSchema,
} from './ballot-read';

setupRitewayBun();

const id = (word: string) => word.padEnd(24, '0');

const definition = {
  version: 2,
  points: { min: 20, max: 30, step: 0.5, lowPointWin: false },
  ranks: false,
  criteria: [],
  outcomes: { winner: true, doubleLoss: true },
  written: {
    reason: 'required',
    feedback: 'optional',
    privateNote: 'optional',
  },
};

const eventBallot = {
  lobbyId: id('lobby'),
  eventId: id('event'),
  definition,
  pin: {
    kind: 'template',
    templateId: id('template'),
    organizationName: 'Southeast League',
  },
  usedIn: { first: 1, last: 3 },
  screening: 'hold',
  capabilities: { setScreening: true },
};

const judgeBallot = {
  fixtureId: id('fixture'),
  tournamentName: 'Autumn Open',
  eventName: null,
  tabRoundName: 'Semifinal',
  placeName: 'Room 1',
  panel: { size: 3, position: 1, chair: false },
  resolution: { kind: 'released', text: 'Cities should charge drivers.' },
  definition,
  subjectKind: 'debater',
  subjects: [
    { key: 'jensen', name: 'Jensen', role: 'Affirmative' },
    { key: 'doyle', name: 'Doyle', role: 'Negative' },
  ],
  draft: { winner: 'jensen', points: { jensen: 28.5, doyle: 29 }, reason: '' },
  reasonAudiences: ['responsible_adults', 'competitors'],
};

describe('EventBallotView', async () => {
  test('a pinned definition', () => {
    const own = { ...eventBallot, pin: { kind: 'event' }, usedIn: null };
    assert({
      given: 'a definition pinned by a template, and one the event set',
      should: 'parse each unchanged',
      actual: [
        parseOutcome(eventBallotViewSchema, eventBallot),
        parseOutcome(eventBallotViewSchema, own),
      ],
      expected: [{ data: eventBallot }, { data: own }],
    });
  });

  test('a private note is never required', () => {
    assert({
      given: 'a definition requiring a private note',
      should: 'refuse it',
      actual: parseOutcome(eventBallotViewSchema, {
        ...eventBallot,
        definition: {
          ...definition,
          written: { ...definition.written, privateNote: 'required' },
        },
      }),
      expected: { issues: ['definition.written.privateNote'] },
    });
  });

  test('a scale runs upward', () => {
    assert({
      given: 'points from 30 to 20',
      should: 'refuse the scale',
      actual: parseOutcome(eventBallotViewSchema, {
        ...eventBallot,
        definition: {
          ...definition,
          points: { ...definition.points, min: 30, max: 20 },
        },
      }),
      expected: { issues: ['definition.points.max'] },
    });
  });
});

describe('JudgeBallotView', async () => {
  test("a judge's own ballot", () => {
    assert({
      given: 'a wing judge drafting a semifinal ballot',
      should: 'parse unchanged',
      actual: parseOutcome(judgeBallotViewSchema, judgeBallot),
      expected: { data: judgeBallot },
    });
  });

  test('a strict shape', () => {
    assert({
      given: 'a ballot carrying an unknown field',
      should: 'refuse it',
      actual: parseOutcome(judgeBallotViewSchema, {
        ...judgeBallot,
        href: '/x',
      }),
      expected: { issues: ['(root)'] },
    });
  });
});

const official = {
  viewer: 'official',
  ballotId: id('ballot'),
  fixtureId: id('fixture'),
  judgeName: 'L. Malik',
  decision: 'jensen',
  scores: { jensen: 28.5, doyle: 27 },
  reason: 'Call me on 555 0100 about the cost argument.',
  feedback: { jensen: 'Slow down.', doyle: 'Answer the data.' },
};
const closed = { open: false };
/** A competitor's view after the decision opened, before anything else did. */
const competitor = {
  viewer: 'audience',
  ballotId: id('ballot'),
  fixtureId: id('fixture'),
  judgeName: 'L. Malik',
  decision: { open: true, value: 'jensen' },
  scores: closed,
  reason: closed,
  feedback: closed,
};
/** A responsible adult's view once every part opened, the reason held by screening. */
const responsibleAdult = {
  ...competitor,
  scores: { open: true, value: { jensen: 28.5, doyle: 27 } },
  reason: { open: true, value: { screening: 'held' } },
  feedback: {
    open: true,
    value: {
      jensen: { screening: 'clear', text: 'Slow down.' },
      doyle: { screening: 'clear', text: 'Answer the data.' },
    },
  },
};
/** The public's view: nothing opened to it. */
const publicView = { ...competitor, decision: closed };

describe('BallotView', async () => {
  test('a variant for each audience that sees less', () => {
    const views = [official, responsibleAdult, competitor, publicView];
    assert({
      given: 'an official, a responsible adult, a competitor and the public',
      should: 'parse each variant unchanged',
      actual: views.map((view) => parseOutcome(ballotViewSchema, view)),
      expected: views.map((data) => ({ data })),
    });
  });

  test('an audience reads only screened text', () => {
    assert({
      given: "an audience view carrying the judge's original reason",
      should: 'refuse it',
      actual: parseOutcome(ballotViewSchema, {
        ...competitor,
        reason: { open: true, value: official.reason },
      }),
      expected: { issues: ['reason.value'] },
    });
  });

  test('a closed part carries nothing', () => {
    assert({
      given: 'a closed decision carrying the winner',
      should: 'refuse the value',
      actual: parseOutcome(ballotViewSchema, {
        ...competitor,
        decision: { open: false, value: 'jensen' },
      }),
      expected: { issues: ['decision'] },
    });
  });
});

describe('ballotReadCatalogue', async () => {
  test('gates', () => {
    assert({
      given: 'the ballot reads',
      should:
        'gate the definition on lobby.host.read and ballots on ballot.read',
      actual: ballotReadCatalogue,
      expected: {
        EventBallotView: { gate: ['lobby.host.read'] },
        JudgeBallotView: { gate: ['ballot.read'] },
        BallotView: { gate: ['ballot.read'] },
      },
    });
  });
});
