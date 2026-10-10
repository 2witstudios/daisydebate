import { authorizationPrincipal as principal } from './authorization.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { buildRoomTopic } from '@daisy/protocol';
import type { RealtimeApp } from './app';
import { createRealtimeAuthorization } from './authorization';

setupRitewayBun();

for (const account of [null, { revision: 9 }])
  test(`Room projection denies unavailable or revised account ${JSON.stringify(account)}`, async () => {
    const resources = {
      clock: { now: () => '2026-10-09T00:00:00.000Z' },
      database: {
        readAuthorizationSession: async () => ({
          ...principal,
          account: { ...principal, member: true, erased: false, revision: 2 },
          expiresAt: '2026-10-09T00:01:00.000Z',
        }),
        readRoomAuthorizationFacts: async () => ({ account }),
      },
    } as unknown as RealtimeApp;
    assert({
      given:
        'a current session followed by a missing or revised Room account fact',
      should: 'deny before evaluating or returning a Room subscription grant',
      actual: await createRealtimeAuthorization({
        resources,
        now: () => 0,
      }).authorizeTopic(principal, buildRoomTopic('r'.repeat(24))),
      expected: null,
    });
  });
