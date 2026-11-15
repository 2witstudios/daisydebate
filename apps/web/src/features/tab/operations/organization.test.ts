import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { authorize } from '@daisy/auth/authorization';
import {
  CommandIdTaken,
  type LoadedOrganizationCommand,
  type OrganizationCommandSession,
  type TabStore,
} from '@daisy/db/tab';
import type { ActionHistoryEntry } from '@daisy/protocol/lobby/command';
import { organizationCommand } from './organization';

setupRitewayBun();

const id = (c: string) => c.repeat(24);
const now = '2027-03-06T08:00:00.000Z';
const principal = { kind: 'user' as const, userId: id('u'), actorId: id('a') };
const loaded: LoadedOrganizationCommand = {
  decision: {
    now,
    senderUserId: id('u'),
    newId: id('n'),
    organization: null,
    handleTaken: false,
    memberships: [],
    grants: [],
    role: null,
    lobby: null,
    personAgeBand: null,
    staffMinimumBand: 'adult',
  },
  authorization: {
    account: {
      userId: id('u'),
      actorId: id('a'),
      member: true,
      erased: false,
      revision: 1,
      beta: { state: 'approved', revision: 1 },
      ageBand: 'adult',
      restricted: false,
      boundary: null,
    },
    organization: null,
    grants: [],
    membership: null,
  },
  roleNamed: null,
};

const harness = (idTakenElsewhere = false) => {
  const applied: { writes: unknown[]; history: ActionHistoryEntry }[] = [];
  const asked: unknown[] = [];
  const store: Pick<TabStore, 'organizationCommand'> = {
    organizationCommand: (input, work) => {
      asked.push(input);
      const session: OrganizationCommandSession = {
        stored: async () => null,
        load: async () => loaded,
        apply: async (writes, history) => {
          if (idTakenElsewhere) throw new CommandIdTaken();
          applied.push({ writes: [...writes], history });
        },
      };
      return work(session);
    },
  };
  const send = organizationCommand({
    store,
    authorize,
    now: () => now,
    newId: () => id('n'),
    hostingPlan: async () => true,
  });
  return { send, applied, asked };
};

const create = {
  version: 1,
  commandId: id('c'),
  expected: {},
  command: {
    type: 'create-organization',
    kind: 'league',
    name: 'Valley League',
    handle: 'valley',
  },
};

describe('organizationCommand', () => {
  test('a malformed envelope', async () => {
    const { send, asked } = harness();
    let code: unknown = null;
    try {
      await send(principal, { ...create, version: 2 });
    } catch (error) {
      code = (error as { code?: unknown }).code;
    }
    assert({
      given: 'an envelope the protocol schema refuses',
      should: 'refuse it as invalid before the store is opened',
      actual: [code, asked.length],
      expected: ['VALIDATION', 0],
    });
  });
  test('creating a league', async () => {
    const { send, applied, asked } = harness();
    const answer = await send(principal, create);
    const [entry] = applied;
    assert({
      given: 'an adult on the hosting plan creating a league',
      should: 'accept it at version 1 and append one entry under the minted id',
      actual: {
        answer: answer.kind,
        asked: asked.length,
        writes: entry?.writes.length,
        scope: entry?.history.scope,
        authority: entry?.history.authority,
        digest: /^[0-9a-f]{64}$/.test(entry?.history.payloadDigest ?? ''),
        appliedAt: entry?.history.appliedAt,
      },
      expected: {
        answer: 'accepted',
        asked: 1,
        writes: 2,
        scope: { kind: 'organization', organizationId: id('n') },
        authority: { kind: 'fixed' },
        digest: true,
        appliedAt: now,
      },
    });
  });
  test('a command id another tenant recorded', async () => {
    const { send, applied } = harness(true);
    assert({
      given:
        'a new-looking command id the record already holds behind another fence',
      should: 'answer a command conflict and apply nothing',
      actual: [await send(principal, create), applied.length],
      expected: [{ kind: 'refused', refusal: 'command-conflict' }, 0],
    });
  });
});
