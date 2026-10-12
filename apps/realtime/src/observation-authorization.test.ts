import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createObservationAuthorityDecision } from '@daisy/auth/observation';
import type { ObservationAuthorityContext } from '@daisy/db/observation';
setupRitewayBun();
const principal = {
  kind: 'user',
  userId: 'u'.repeat(24),
  actorId: 'a'.repeat(24),
  sessionId: 's'.repeat(24),
} as const;
const account = {
  userId: principal.userId,
  actorId: principal.actorId,
  member: true,
  erased: false,
  revision: 1,
};
const context: ObservationAuthorityContext = {
  principal,
  account,
  session: { ...principal, account, expiresAt: '2026-10-12T00:01:00.000Z' },
  resource: { kind: 'round', id: 'r'.repeat(24) },
  resourceFact: {
    kind: 'round',
    roundId: 'r'.repeat(24),
    visibility: 'private',
    createdByActorId: 'b'.repeat(24),
    status: 'active',
    revision: 1,
    participants: [
      { actorId: principal.actorId, role: 'affirmative', slot: 0 },
    ],
  },
  databaseNow: '2026-10-12T00:00:00.000Z',
};
test('named composition preserves canonical resource authority', () => {
  const decide = createObservationAuthorityDecision({});
  const allowed = decide(context);
  const denied = decide({
    ...context,
    resourceFact: {
      ...context.resourceFact,
      participants: [],
    } as ObservationAuthorityContext['resourceFact'],
  });
  assert({
    given: 'private Round participant and unrelated reader',
    should:
      'issue shared safe disclosure only after canonical authorize permits',
    actual: [
      allowed.status,
      denied.status,
      allowed.status === 'allowed' ? allowed.partition : null,
    ],
    expected: [
      'allowed',
      'denied',
      { kind: 'shared', policyKey: 'round-clock-v1' },
    ],
  });
});
