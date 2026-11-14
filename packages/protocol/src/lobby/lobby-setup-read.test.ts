import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseOutcome } from '../parse-outcome.test-support';
import { lobbySetupReadCatalogue, lobbySetupViewSchema } from './lobby-setup-read';

setupRitewayBun();

const id = (name: string) => name.padEnd(24, '0');
const outcome = (input: unknown) => {
  const parsed = parseOutcome(lobbySetupViewSchema, input);
  return 'data' in parsed ? 'ok' : parsed.issues;
};
const league = { organizationId: id('league'), name: 'Southeast League' };

const round = {
  tabRoundId: id('round'),
  stageId: id('prelim'),
  number: 1,
  name: null,
  timeSlotId: id('slot'),
  resolutionPoolId: id('pool'),
};
const event = {
  eventId: id('event'),
  name: 'Varsity debate',
  label: 'VD',
  entryKind: 'person',
  format: { formatId: id('format'), formatVersion: 1, name: 'League one-on-one' },
  ballotDefinition: null,
  template: { templateId: id('template'), name: 'Varsity debate', organization: league },
  stages: [
    {
      stageId: id('prelim'),
      kind: 'preliminary',
      sequence: 1,
      division: null,
      place: 'online',
      timing: 'live',
    },
  ],
  tabRounds: [round],
  sanction: { organization: league, status: 'requested', requestedAt: '2026-11-12T16:00:00.000Z' },
} as const;
const tournament = {
  kind: 'tournament',
  lobbyId: id('autumn'),
  handle: 'autumn-open',
  name: 'Autumn Open',
  owner: league,
  status: 'open',
  events: [event],
  timeSlots: [{ timeSlotId: id('slot'), name: 'Debate', startsAt: '2026-11-14T10:00:00.000Z' }],
  resolutionPools: [{ resolutionPoolId: id('pool'), name: 'Autumn Open', size: 18 }],
  capabilities: { manage: true },
} as const;
const standing = {
  kind: 'standing',
  lobbyId: id('lobby'),
  handle: 'southeast',
  name: 'Southeast League',
  owner: league,
  templates: [{ templateId: id('template'), name: 'Varsity', format: { formatId: id('format'), name: 'One-on-one' } }],
  seasons: [{ seasonId: id('season'), name: '2026 to 27 season' }],
  ladder: { ladderId: id('ladder'), name: 'Southeast League' },
  capabilities: { manage: true, createRoom: true },
} as const;

describe('lobby setup read', async () => {
  test('one contract for both kinds', () => {
    assert({
      given: 'a standing lobby and a tournament',
      should: 'parse each',
      actual: [outcome(standing), outcome(tournament)],
      expected: ['ok', 'ok'],
    });
  });

  test('what it refuses', () => {
    assert({
      given: 'a round in a slot the tournament lacks, a round of another stage, offered templates on a tournament, resolution text',
      should: 'refuse each where it is wrong',
      actual: [
        outcome({ ...tournament, timeSlots: [] }),
        outcome({
          ...tournament,
          events: [{ ...event, tabRounds: [{ ...round, stageId: id('elim') }] }],
        }),
        outcome({ ...tournament, templates: standing.templates }),
        outcome({
          ...tournament,
          resolutionPools: [{ ...tournament.resolutionPools[0], texts: ['This house…'] }],
        }),
      ],
      expected: [['events'], ['events.0.tabRounds'], ['(root)'], ['resolutionPools.0']],
    });
    assert({
      given: 'the catalogue',
      should: 'gate setup on lobby.host.read',
      actual: lobbySetupReadCatalogue.LobbySetupView.gate,
      expected: ['lobby.host.read'],
    });
  });
});
