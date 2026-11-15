import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type {
  ActionHistoryEntry,
  LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';
import { historyRowOf, storedCommandOf } from './command-record';

setupRitewayBun();

const id = (c: string) => c.repeat(24);
const receipt: LobbyCommandReceipt = {
  commandId: id('c'),
  aggregate: { kind: 'organization', id: id('o') },
  resultingVersion: 2,
  replayed: false,
  findings: [],
  fixtureChanges: [],
};
const entry: ActionHistoryEntry = {
  commandId: id('c'),
  scope: { kind: 'organization', organizationId: id('o') },
  aggregate: { kind: 'organization', id: id('o') },
  type: 'give-grant',
  actorUserId: id('u'),
  authority: { kind: 'grant', grantId: id('g') },
  conflictId: null,
  confirmedByUserId: null,
  payloadDigest: 'a'.repeat(64),
  resultingVersion: 2,
  appliedAt: '2027-03-06T08:00:00.000Z',
};

describe('historyRowOf', () => {
  test('an entry under a grant at an organization', () => {
    assert({
      given: 'an accepted command under a grant',
      should: 'key the row on the organization and name the grant',
      actual: historyRowOf(entry, receipt),
      expected: {
        commandId: id('c'),
        organizationId: id('o'),
        lobbyId: null,
        subjectPersonUserId: null,
        actorUserId: id('u'),
        authority: 'grant',
        grantId: id('g'),
        relation: null,
        serviceId: null,
        aggregateKind: 'organization',
        aggregateId: id('o'),
        conflictId: null,
        type: 'give-grant',
        payloadDigest: 'a'.repeat(64),
        result: receipt,
        resultingVersion: 2,
        appliedAt: new Date('2027-03-06T08:00:00.000Z'),
      },
    });
  });
  test('a service at a lobby', () => {
    const row = historyRowOf(
      {
        ...entry,
        scope: { kind: 'lobby', lobbyId: id('l') },
        actorUserId: null,
        authority: { kind: 'service', serviceId: 'clock' },
      },
      receipt,
    );
    assert({
      given: 'a service command in a lobby',
      should: 'key the row on the lobby and name only the service',
      actual: [
        row.organizationId,
        row.lobbyId,
        row.authority,
        row.grantId,
        row.serviceId,
      ],
      expected: [null, id('l'), 'service', null, 'clock'],
    });
  });
  test('a relationship', () => {
    const row = historyRowOf(
      { ...entry, authority: { kind: 'relationship', relation: 'self' } },
      receipt,
    );
    assert({
      given: 'a command allowed by a relationship',
      should: 'name the relation alone',
      actual: [row.authority, row.relation, row.grantId],
      expected: ['relationship', 'self', null],
    });
  });
  test('a protected person differs from the actor', () => {
    const row = historyRowOf(
      {
        ...entry,
        scope: { kind: 'person', subjectUserId: id('w') },
        authority: { kind: 'relationship', relation: 'guardian' },
      },
      receipt,
    );
    assert({
      given: 'a guardian acting for a distinct protected person',
      should: 'address only the protected person and retain the original actor',
      actual: [
        row.organizationId,
        row.lobbyId,
        row.subjectPersonUserId,
        row.actorUserId,
      ],
      expected: [null, null, id('w'), id('u')],
    });
  });
});

describe('storedCommandOf', () => {
  test('a stored history row', () => {
    assert({
      given: 'the row an accepted command left',
      should: 'answer its actor, digest and receipt as accepted',
      actual: storedCommandOf({
        actorUserId: id('u'),
        payloadDigest: 'a'.repeat(64),
        result: receipt,
      }),
      expected: {
        actorUserId: id('u'),
        payloadDigest: 'a'.repeat(64),
        outcome: { kind: 'accepted', receipt },
      },
    });
  });
});
