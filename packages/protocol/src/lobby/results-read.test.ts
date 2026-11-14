import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { authorizationCapabilitySchema } from '../authorization';
import {
  parseEach,
  parseOutcome,
  parsedUnchanged,
} from '../parse-outcome.test-support';
import { eventResultsViewSchema, resultsReadCatalogue } from './results-read';

setupRitewayBun();

const id = (seed: string) => seed.padEnd(24, 'x');
const at = (time: string) => `2026-10-17T${time}:00.000Z`;

const shape = {
  lobbyId: id('lobby'),
  eventId: id('event'),
  prelimsCertifiedAt: at('16:52'),
  certification: {
    kind: 'blocked',
    running: [{ tabRoundId: id('tabroundsemis'), name: 'Semifinals' }],
  },
  audiences: [
    {
      audience: 'competitors',
      openings: [
        {
          part: 'decision',
          state: { kind: 'open', cause: 'round_close', openedAt: at('15:10') },
        },
        { part: 'scores', state: { kind: 'openable' } },
      ],
    },
  ],
  corrections: [
    {
      resultId: id('resultnew'),
      supersedesResultId: id('resultold'),
      tabRoundNumber: 2,
      fixture: {
        fixtureId: id('fixture'),
        entries: [{ entryId: id('entryreid'), name: 'Reid' }],
      },
      changed: 'winner',
      recordedBy: { actorId: id('actorabara'), name: 'D. Abara' },
      confirmedBy: {
        actorId: id('actorhost'),
        name: 'Sam Rivera',
        viewer: true,
      },
      recordedAt: at('17:20'),
      usedByPublishedDraws: [{ drawId: id('draw3'), tabRoundNumber: 3 }],
    },
  ],
  sanction: { organizationName: 'Southeast League', sentAt: null },
  capabilities: { release: true, certify: false },
};

const official = {
  ...shape,
  ballotAccess: 'unreleased',
  screeningHolds: { count: 2, summary: 'One is flagged for language.' },
};
const released = { ...shape, ballotAccess: 'released' };

describe('the event results read', () => {
  test('one variant for each ballot access', () => {
    assert({
      given: 'a viewer who may read unreleased ballots, and one who may not',
      should: 'parse each as it is',
      actual: parseEach(eventResultsViewSchema, [official, released]),
      expected: parsedUnchanged([official, released]),
    });
  });

  test('screening holds are absent for a viewer who may not read unreleased ballots', () => {
    assert({
      given:
        'the released variant carrying screening holds, and the unreleased one without them',
      should: 'refuse both',
      actual: parseEach(eventResultsViewSchema, [
        { ...released, screeningHolds: official.screeningHolds },
        { ...shape, ballotAccess: 'unreleased' },
      ]),
      expected: [{ issues: ['(root)'] }, { issues: ['screeningHolds'] }],
    });
  });

  test('what an event results read refuses', () => {
    assert({
      given:
        'an opening of the posting, an audience outside the list and an unknown key',
      should: 'refuse each at the field',
      actual: parseEach(eventResultsViewSchema, [
        {
          ...released,
          audiences: [
            {
              audience: 'public',
              openings: [{ part: 'posting', state: { kind: 'openable' } }],
            },
          ],
        },
        {
          ...released,
          audiences: [
            {
              audience: 'officials',
              openings: [{ part: 'decision', state: { kind: 'openable' } }],
            },
          ],
        },
        { ...released, recompute: true },
      ]),
      expected: [
        { issues: ['audiences.0.openings.0.part'] },
        { issues: ['audiences.0.audience'] },
        { issues: ['(root)'] },
      ],
    });
  });

  test('the event results read answers under the host read gate', () => {
    assert({
      given: 'the results read catalogue',
      should: 'name lobby.host.read, a real capability',
      actual: resultsReadCatalogue.EventResultsView.gate.map((gate) =>
        parseOutcome(authorizationCapabilitySchema, gate),
      ),
      expected: [{ data: 'lobby.host.read' }],
    });
  });
});
