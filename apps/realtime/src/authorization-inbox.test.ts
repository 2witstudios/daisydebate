import { assert, setupRitewayBun, test } from 'riteway/bun';
import { buildUserInboxTopic } from '@daisy/protocol';
import { createRealtimeAuthorization } from './authorization';
import type { RealtimeApp } from './app';

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
  erased: false,
  revision: 1,
};

test('own inbox subscribes only through current canonical account authority', async () => {
  const instant = '2026-10-09T00:00:00.000Z';
  const expiresAt = '2026-10-09T00:00:01.000Z';
  const cases = [
    account,
    { ...account, erased: true },
    { ...account, member: false },
    { ...account, revision: 0 },
    { ...account, userId: 'v'.repeat(24) },
  ];
  const actual = [];
  for (const current of cases) {
    const resources = {
      clock: { now: () => instant },
      database: {
        readAuthorizationSession: async () => ({
          ...principal,
          account: current,
          expiresAt,
        }),
      },
    } as unknown as RealtimeApp;
    const authorization = createRealtimeAuthorization({
      resources,
      now: () => Date.parse(instant),
    });
    actual.push(
      (
        await authorization.authorizeTopic(
          principal,
          buildUserInboxTopic(principal.actorId),
        )
      )?.validUntil ?? null,
    );
  }
  assert({
    given:
      'own inbox with bound member, erased, nonmember, invalid-revision or foreign account facts',
    should:
      'use the sole canonical inbox capability and preserve the real session deadline',
    actual,
    expected: [Date.parse(expiresAt), null, null, null, null],
  });
});
