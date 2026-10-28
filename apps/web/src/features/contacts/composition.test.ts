import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock, sequentialId } from '@daisy/clock';
import type { ContactStore } from '@daisy/db/contacts';
import { betaMessagingPolicy } from '../messaging/beta-policy';
import { createMessagingUnitApp } from '../messaging/messaging-app.test-support';
import { signedMessagingAuth } from '../messaging/signed-messaging.test-support';
import { usernameDiscoveryWindows } from '../account/username-discovery';
import { composeContactRoutes } from './composition';

setupRitewayBun();

const me = 'a'.repeat(24),
  them = 'b'.repeat(24);

test('a block by username spends discovery, then Contacts’ own block budget', async () => {
  const { auth, cookie } = await signedMessagingAuth(
    me,
    'contacts-composition@daisy.example.com',
  );
  const app = createMessagingUnitApp({
    clock: fixedClock('2026-10-28T03:00:00.000Z'),
    ids: sequentialId('contacts-composition'),
    messagingPolicy: betaMessagingPolicy,
  });
  const spent: string[] = [];
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
  const routes = (known: boolean) =>
    composeContactRoutes({
      ...app,
      auth: () => auth,
      limiter: {
        consume: async (key) => {
          spent.push(key);
          return { allowed: true, retryAfterSeconds: 0 };
        },
      },
      database: {
        ...app.database,
        contactStore: () => store,
        lookupHumanActorByUsername: async () => (known ? them : null),
      },
    });
  const origin = auth.config.PUBLIC_APP_URL;
  const post = () =>
    new Request(`${origin}/api/contacts/username`, {
      method: 'POST',
      headers: { cookie, origin, 'content-type': 'application/json' },
      body: JSON.stringify({
        version: 1,
        requestId: 'r'.repeat(24),
        username: 'peer',
        blocked: true,
      }),
    });
  const discovery = usernameDiscoveryWindows.map(
    (rule) => `username-discovery:${me}:${rule.windowSeconds}`,
  );
  try {
    const known = await routes(true).blockByUsername(post());
    const afterKnown = [...spent];
    spent.length = 0;
    stored.length = 0;
    const unknown = await routes(false).blockByUsername(post());
    assert({
      given: 'a block of a known username, then of an unknown one',
      should:
        'spend discovery then the block budget for the first, and only discovery for the second, which reaches no store',
      actual: [known.status, afterKnown, unknown.status, spent, stored],
      expected: [
        200,
        [
          ...discovery,
          `contacts:block:${me}:10`,
          `contacts:block:${me}:60`,
          `contacts:block:${me}:3600`,
        ],
        403,
        discovery,
        [],
      ],
    });
  } finally {
    await app.close();
  }
});
