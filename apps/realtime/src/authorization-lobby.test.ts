import { instantMs } from '@daisy/clock';
import type { AuthorityResources } from './authorization';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  buildLobbyHostTopic,
  buildLobbyTopic,
  buildOrganizationHostTopic,
} from '@daisy/protocol/topics';
import { createRealtimeAuthorization } from './authorization';
import { refuseAllReading } from './authorization.test-support';

setupRitewayBun();
const principal = {
  userId: 'u'.repeat(24),
  actorId: 'a'.repeat(24),
  sessionId: 's'.repeat(24),
};
const account = {
  userId: principal.userId,
  actorId: principal.actorId,
  member: true,
  beta: { state: 'approved' as const, revision: 1 },
  ageBand: 'adult' as const,
  restricted: false,
  erased: false,
  revision: 1,
};

test('lobby and organization topics are refused until their facts load', async () => {
  const instant = '2026-10-09T00:00:00.000Z';
  const resources = {
    clock: { now: () => instant },
    database: {
      readAuthorizationSession: async () => ({
        ...principal,
        account,
        expiresAt: '2026-10-09T00:00:01.000Z',
      }),
    },
  } as unknown as AuthorityResources;
  const authorization = createRealtimeAuthorization({
    readingPolicy: refuseAllReading,
    resources,
    now: () => instantMs(instant),
  });
  const id = 'l'.repeat(24);
  const actual = await Promise.all(
    [
      buildLobbyTopic(id),
      buildLobbyHostTopic(id),
      buildOrganizationHostTopic(id),
    ].map((topic) => authorization.authorizeTopic(principal, topic)),
  );
  assert({
    given: 'a live member subscribing to each lobby and organization family',
    should:
      'refuse each, so wiring cannot open one without changing this test (TAB-5.15)',
    actual,
    expected: [null, null, null],
  });
});
