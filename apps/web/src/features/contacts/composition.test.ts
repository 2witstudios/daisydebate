import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { ContactStore } from '@daisy/db/contacts';
import {
  discoverySpends,
  openRecordedMember,
} from '../account/username-discovery.test-support';
import { dec251ContactsPolicy } from './request-policy';

/** Block windows that differ from discovery's, so neither can stand in for the other. */
const blocks = [{ max: 1, windowSeconds: 10 }];
import { composeContactRoutes } from './composition';

setupRitewayBun();

const me = 'a'.repeat(24),
  them = 'b'.repeat(24);

test('a block by username spends discovery under its own windows, then Contacts’ own block budget', async () => {
  const stored: string[] = [];
  const store: ContactStore = {
    withContacts: async (_input, work) => {
      stored.push('frame');
      return work({
        contacts: [
          { lowActorId: me, highActorId: them, blocked: false, revision: 1 },
        ],
        blocking: false,
        readReceipt: async () => null,
        commitBlock: async (block) => ({ blocked: block.blocked, revision: 2 }),
      });
    },
  };
  const open = (known: boolean) =>
    openRecordedMember(
      me,
      `contacts-${String(known)}@daisy.example.com`,
      composeContactRoutes,
      {
        contactsPolicy: { ...dec251ContactsPolicy, blocks },
        database: {
          contactStore: () => store,
          lookupHumanActorByUsername: async () => (known ? them : null),
        },
      },
    );
  const body = {
    version: 1,
    requestId: 'r'.repeat(24),
    username: 'peer',
    blocked: true,
  };
  const known = await open(true);
  const unknown = await open(false);
  try {
    const knownStatus = (
      await known.routes.blockByUsername(
        known.post('/api/contacts/username', body),
      )
    ).status;
    const storedAfterKnown = stored.splice(0);
    const unknownStatus = (
      await unknown.routes.blockByUsername(
        unknown.post('/api/contacts/username', body),
      )
    ).status;
    assert({
      given: 'a block of a known username, then of an unknown one',
      should:
        'spend discovery’s own windows then the block budget for the first, and only discovery for the second, which reaches no store',
      actual: [
        knownStatus,
        known.spent,
        storedAfterKnown,
        unknownStatus,
        unknown.spent,
        stored,
      ],
      expected: [
        200,
        [
          ...discoverySpends(me),
          ...blocks.map((rule) => [
            `contacts:block:${me}:${rule.windowSeconds}`,
            rule,
          ]),
        ],
        ['frame'],
        403,
        discoverySpends(me),
        [],
      ],
    });
  } finally {
    await known.close();
    await unknown.close();
  }
});
